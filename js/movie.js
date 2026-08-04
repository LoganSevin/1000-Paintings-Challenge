/**
 * Movie — hour-scale follow-along: 10s clips × 360 = 60 minutes.
 * Bulk-random sources from paintings + generated + characters/objects/places/stasis/fallout.
 * Each beat: still → 10s video; cinema chains the reel.
 */
(function () {
  "use strict";

  var CLIP_SEC = 10;
  var CLIPS_PER_MINUTE = 6;
  var FULL_HOUR_CLIPS = 360;
  var SOURCES_PER_CLIP = 3;
  var STORAGE_KEY = "movie-project-v2";
  var PREFS_KEY = "movie-prefs-v1";
  var FETCH_TIMEOUT_MS = 180000;
  var VIDEO_WAIT_TIMEOUT_MS = 12 * 60 * 1000;
  var POLL_INTERVAL_MS = 1200;
  var REF_MAX_SIDE = 1280;
  var REF_QUALITY = 0.9;
  /** xAI / vision APIs reject prompts over 4096 (bytes or chars). Stay under with margin. */
  var PROMPT_MAX = 3900;
  var STASIS_MAX = 1800;
  var LIFE_PROMPT_MAX = 3600;

  /** Gallery folders / collections beyond the 1000 paintings archive. */
  var ASSET_COLLECTIONS = ["generated", "characters", "objects", "places", "stasis", "fallout"];

  var MOTION_BEATS = [
    "Soft living atmosphere — light drifts, pigment breathes, gentle internal motion. Fixed camera.",
    "Painterly wind — fabric and foliage stir, glaze shimmers, shadows crawl. Fixed camera.",
    "Pulse of color — palette glows and eases, edges hum with life. Fixed camera.",
    "Quiet drama — figures shift weight almost imperceptibly, eyes catch light. Fixed camera.",
    "Weather inside the frame — mist, dust, or heat haze moves through the scene. Fixed camera.",
    "Ritual stillness with life — candle flame, water, smoke, or brush-energy micro-motion. Fixed camera.",
    "Epic sweep of atmosphere — clouds, light beams, or cosmic dust drift. Fixed camera.",
    "Intimate close life — surface texture lives; no camera move, no redesign.",
  ];

  var ACT_TITLES = [
    "Overture",
    "Threshold",
    "Wander",
    "Collision",
    "Descent",
    "Ascent",
    "Echo",
    "Oracle",
    "Fracture",
    "Return",
    "Afterglow",
    "Midnight",
    "Rift",
    "Bloom",
    "Undertow",
    "Crown",
    "Ember",
    "Veil",
  ];

  /**
   * SCENE only — stage picture / setting (no dialogue). Spell hooks fill the visual.
   * Like a director's scene heading + action lines, not a chat.
   */
  var SCENE_TEMPLATES = [
    "SCENE — Act {act}, Beat {n}. SETTING: a fused world where the landscape of “{title0}” and the architecture of “{title1}” occupy one space. VISUAL KEY: {hook0}. COUNTER-IMAGE: {hook1}. FAR DETAIL / WITNESS: {hook2}. Mood: {mood}. Style blend: {style0} × {style1}. Medium feel: {medium0} meeting {medium1}. One coherent tableau — not a collage of panels. No readable text in frame.",
    "SCENE — Exterior/Interior undecided: a threshold from “{title0}” opens into the weather of “{title1}”. Foreground carries the DNA of {hook0}. Midground rearranges into {hook1}. Background holds the afterimage of “{title2}” ({hook2}). Palette tension between {colors0} and {colors1}. Act: {act}.",
    "SCENE — Processional space. Ground painted in the logic of “{title0}”; sky rewritten by “{title1}”; a third presence from “{title2}” as light or relic. Action-in-image: {hook0} interrupted by {hook1}, underlit by {hook2}. {style0} handwriting must stay legible. Fixed composition, {mood}.",
    "SCENE — Chamber of aftermath. Walls remember “{title0}” ({desc0}). Floor becomes “{title1}” ({desc1}). A window or void shows “{title2}” ({hook2}). Still-life gravity with mythic scale. Act {act}. No speech printed on the image.",
    "SCENE — Dream geography: walk the brushwork of {style0} until it becomes {style1}. Object or figure-group centered; environment hybrid of spells {label0}, {label1}, {label2}. Specifics: {hook0} / {hook1} / {hook2}. Mood {mood}.",
    "SCENE — Ritual ground. Circle, path, or table suggested by “{title0}”; witnesses suggested by “{title1}”; omen in the margin from “{title2}”. Visual thesis {hook0}; price {hook1}; proof {hook2}. One still, cinematic, painterly.",
  ];

  /** First names — mixed eras / tones for play-like casts */
  var FIRST_NAMES = [
    "Eden", "Cassidy", "Maren", "Jules", "Orrin", "Sable", "Wren", "Ivo", "Noa", "Remy",
    "Tamsin", "Leander", "Briar", "Quill", "Asha", "Dorian", "Lior", "Percy", "Halcyon", "Vesper",
    "Rowan", "Celeste", "Merrick", "Isolde", "Gideon", "Nyx", "Thorne", "Ophelia", "Silas", "Juniper",
    "Caspian", "Maeve", "Orla", "Tobias", "Seraphine", "Clement", "Yara", "Fen", "Lucian", "Hester",
    "Ambrose", "Zinnia", "Corin", "Beatrix", "Evander", "Mercy", "Aldric", "Saffron", "Pascal", "Nerys",
    "Imogen", "Rafael", "Cosima", "Leopold", "Agnes", "Balthazar", "Cora", "Dashiell", "Eulalia", "Fergus",
    "Prosper", "Lavinia", "Horatio", "Minerva", "Cyrus", "Delphine", "Otis", "Ruth", "Solomon", "Vera",
  ];

  var LAST_NAMES = [
    "Marrow", "Voss", "Ashcroft", "Quillan", "Blackwell", "Mercer", "Harrow", "Solace", "Graves", "Wynn",
    "Thrush", "Kestrel", "Morrigan", "Pryce", "Langford", "Crowe", "Bellamy", "Sinclair", "Hawke", "Vale",
    "Dunstan", "Whitlock", "Ravenswood", "Cotton", "Proctor", "Good", "Nurse", "Putnam", "Corey", "Mather",
    "Montague", "Capulet", "Verona", "Fairfax", "Ashbury", "Gilt", "Underwood", "Foxe", "Lark", "Briarwood",
    "Nightingale", "Sable", "Winters", "Thatcher", "Osborne", "Crane", "Holloway", "Pershing", "Alden", "Kerr",
  ];

  /** Optional particle / compound surname flavors */
  var SURNAME_PREFIXES = ["van ", "de ", "del ", "von ", "la ", "O'", "Mc", "Mac", ""];
  var SURNAME_SUFFIXES = ["", "", "", "-Cross", "-Ward", "son", "s"];

  var MOTION_OPENERS = [
    "FIXED CAMERA — no pan, no zoom, no redesign.",
    "LOCKED LENS — the frame is a living painting, not a tour.",
    "STILL FRAME, LIVING INSIDE — camera bolted; only the spell-world moves.",
    "TABLEAU VIVANT RULES — composition frozen; internal life only.",
  ];

  var MOTION_KINETICS = [
    "Let {style0} brushwork on {title0} re-decide itself: edges crawl, glaze blooms, then settles.",
    "Light crawls across {hook0} as if the sun were thinking twice — shadows from {title1} lengthen a finger-width then retract.",
    "{title0}'s world exhales: fabric, hair, smoke, or foliage borrowed from {hook1} stirs, then holds.",
    "Color tide: {colors0} push into territory held by {colors1}; the seam shimmers without changing the drawing.",
    "Micro-life of {mood}: a blink, a weight-shift, a pupil flare if a figure exists — otherwise pigment weather from {title2}.",
    "Depth breathing — near planes of {title0} hold still while far weather of {title1} ({hook1}) drifts like underwater light.",
    "Ritual flicker: something small and sacred moves — flame, water skin, eye-glint, leaf tremor — born in {title0}, answered by {title1}.",
    "Afterimage pulse of {title2}: {hook2} appears as a half-second ghost overlay, then folds back into the paint.",
    "Surface tension: {medium0} looks wetter for a beat, then dries; {medium1} cracks whisper open and close.",
    "The hybrid body of the still shifts weight from {title0}'s anatomy toward {title1}'s silhouette — never a cut, only a morph of presence.",
    "Edges of {hook0} boil softly (painterly boil, not cartoon) while the center holds the gravity of {act}.",
    "A slow parallax of meaning: background from {title2} slides a hair's breadth; foreground of {title0} refuses to follow.",
  ];

  var MOTION_SPELL_BEATS = [
    "Honor spell {label0} “{title0}”: keep its {style0} handwriting legible while it lives — {hook0}.",
    "Channel spell {label1} “{title1}”: let its private weather enter as motion only — {hook1}.",
    "Leave a ghost signature of spell {label2} “{title2}”: {hook2} as slow pulse or rim-light breath.",
    "If figures exist, their psychology is {mood}: micro-expressions that match {desc0} without rewriting the face.",
    "Texture performance: {tags0} become kinetic hints (ripple, shimmer, grit dance) without new props.",
  ];

  var MOTION_CLOSERS = [
    "Final second: ease all motion to a soft hold so the next 10s can inherit the pose — no hard freeze-cut.",
    "Land on the still's original reading; motion dies like a held breath, ready for audio crossfade.",
    "Settle. The last frames must match the reference still for a seamless loop/join.",
    "Decrescendo of life into poise — act \"{act}\" completes a gesture, does not start a new scene.",
  ];

  var AUDIO_OPENERS = [
    "CONTINUOUS AUDIO BED (no hard silence at either end — built to crossfade):",
    "SONIC BRIDGE for act \"{act}\" — one breath that can hand off to the next page:",
    "UNDERSCORE AS WEATHER, not a pop drop — always-on bed for {mood} cinema:",
    "CROSSFADABLE SCORE — enter mid-texture, leave mid-texture:",
  ];

  var AUDIO_BEDS = [
    "Foundation drone tuned to the emotional key of “{title0}” — low, {mood}, never melodic earworm.",
    "Room-tone hybrid: painter's studio hush × the outdoor air implied by {hook0}.",
    "Sub-bass like distant weather under {title1}; mid haze of {colors0} translated into soft filtered noise.",
    "Gallery reverb tail on everything — as if the spells are hanging in a long hall of {medium0}.",
    "Pulse under 60bpm: heartbeat of paint drying, not a kick drum — tempo of {style0}.",
  ];

  var AUDIO_SPELL_LAYERS = [
    "Layer A (spell {label0} “{title0}”): {sound0} — intimate, close-mic texture, 20–30% presence.",
    "Layer B (spell {label1} “{title1}”): {sound1} — wider stereo bed, never steals the throne from Layer A.",
    "Layer C (spell {label2} “{title2}”): {sound2} — high air / chime / grit as seasoning only, for the last third of the clip.",
    "Motif without melody: a 3-note ghost that never resolves, colored by {colors1}, dissolving before the cut.",
    "Foley-as-paint: soft bristle, wet smear, cloth, distant door — only if it serves {hook0}; no cartoon hits.",
  ];

  var AUDIO_BRIDGES = [
    "Outro 1.5s: peel volume 15% and open a high shelf so the next beat can slide in on the same drone.",
    "Leave a sustained tone (the color of {title2}) ringing under the picture so the following page inherits it.",
    "Do not end on a stinger, riser, or hard stop — end mid-phrase, mid-breath, mid-weather.",
    "Handoff cue: a soft filtered noise swell shaped like the motion of {hook1}, then recede.",
    "Keep 2–3 frequency bands free (a 'socket') for the next clip's lead texture — act \"{act}\" stays the emotional boss.",
  ];

  var SOUND_FROM_STYLE = [
    { re: /abstract|expression/i, s: "roar of distant color fields, scraped metal sigh, air-pressure shifts" },
    { re: /portrait|figure|face/i, s: "close breath, cloth, almost-inaudible pulse, room around a body" },
    { re: /landscape|sky|cloud|horizon/i, s: "wind shear, far thunder, insect grain, open-air hush" },
    { re: /water|sea|ocean|river|rain/i, s: "lap and undertow, droplet ticks, submerged low-pass world" },
    { re: /night|dark|nocturne|moon/i, s: "cricket-void, refrigerator hum of night, distant dog or train ghost" },
    { re: /city|street|urban|architecture/i, s: "far traffic bloom, HVAC drone, shoe-scuff ghosts, glass resonance" },
    { re: /forest|tree|garden|leaf/i, s: "canopy hiss, twig tick, bird-as-memory, chlorophyll silence" },
    { re: /fire|ember|sunset|warm/i, s: "ember crackle bed, warm noise, low furnace breath" },
    { re: /surreal|dream|vision/i, s: "reversed air, glass harmonica ghosts, uncanny quiet" },
    { re: /still life|object|interior/i, s: "clock-adjacent tick, dust motes as noise, wooden room tone" },
  ];

  var MOOD_WORDS = [
    "uncanny",
    "luminous",
    "storm-bitten",
    "hushed",
    "feral",
    "devotional",
    "electric",
    "submerged",
    "sun-struck",
    "ember-dark",
    "glass-clear",
    "mythic",
    "tender-violent",
    "oracle-still",
    "fever-bright",
    "salt-lonely",
    "cathedral-deep",
    "knife-quiet",
  ];

  var state = {
    pool: [],
    analyses: {},
    lod1Analyses: {},
    poolReady: false,
    poolLoading: false,
    poolStats: {},
    project: null,
    producing: false,
    produceAbort: false,
    playing: false,
    playIndex: 0,
    playToken: 0,
    followAlong: true,
    autoSave: true,
    autoProduce: true,
    audioBridge: true,
    aspect: "16:9",
    resolution: "720p",
    targetClips: FULL_HOUR_CLIPS,
    active: false,
    blobUrls: [],
    activePlayer: "a",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function fetchWithTimeout(url, options, ms) {
    ms = ms || FETCH_TIMEOUT_MS;
    options = options || {};
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      options.signal = AbortSignal.timeout(ms);
    }
    return fetch(url, options);
  }

  function parseApiResponse(res) {
    if (window.parseGalleryApiResponse) return window.parseGalleryApiResponse(res);
    return res.text().then(function (text) {
      var t = (text || "").trim();
      if (!t || t.charAt(0) === "<") {
        throw new Error(
          "Server returned HTML — run start_server.bat and open http://localhost:8765 (not file://)."
        );
      }
      return JSON.parse(t);
    });
  }

  function absoluteUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return String(url);
    }
  }

  function isSameOriginUrl(url) {
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  function mediaProxyUrl(url, filename) {
    url = absoluteUrl(url);
    if (!url || url.indexOf("blob:") === 0 || url.indexOf("data:") === 0) return url;
    if (isSameOriginUrl(url)) return url;
    var q =
      "/api/proxy-media?url=" +
      encodeURIComponent(url) +
      (filename ? "&filename=" + encodeURIComponent(filename) : "");
    try {
      return new URL(q, window.location.href).href;
    } catch (e) {
      return q;
    }
  }

  function fetchImageUrl(url) {
    if (!url) return "";
    if (url.indexOf("data:") === 0 || url.indexOf("blob:") === 0) return url;
    if (isSameOriginUrl(url)) return absoluteUrl(url);
    return mediaProxyUrl(url);
  }

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "mv-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
  }

  function paintingUrl(num) {
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function getAnalysis(num) {
    if (typeof window.getAnalysis === "function") {
      try {
        var a = window.getAnalysis(num);
        if (a) return a;
      } catch (e) {}
    }
    if (typeof window.getGalleryAnalysis === "function") {
      try {
        var g = window.getGalleryAnalysis(num);
        if (g) return g;
      } catch (e2) {}
    }
    return state.analyses[String(num)] || state.analyses[num] || null;
  }

  function getLod1Analysis(num) {
    return state.lod1Analyses[String(num)] || state.lod1Analyses[num] || null;
  }

  function setStatus(msg, kind) {
    var el = $("mv-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "mv-status" + (kind ? " " + kind : "");
  }

  function formatClock(totalSec) {
    totalSec = Math.max(0, Math.floor(Number(totalSec) || 0));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) {
      return h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    }
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function clipCountLabel(n) {
    var mins = Math.floor(n / CLIPS_PER_MINUTE);
    var rem = n % CLIPS_PER_MINUTE;
    if (mins >= 60 && rem === 0) return "1 hour";
    if (mins === 1 && rem === 0) return "1 min";
    if (rem === 0) return mins + " min";
    return n + " clips · " + formatClock(n * CLIP_SEC);
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p.aspect) state.aspect = p.aspect;
      if (p.resolution === "480p" || p.resolution === "720p") state.resolution = p.resolution;
      if (typeof p.followAlong === "boolean") state.followAlong = p.followAlong;
      if (typeof p.autoSave === "boolean") state.autoSave = p.autoSave;
      if (typeof p.autoProduce === "boolean") state.autoProduce = p.autoProduce;
      if (typeof p.audioBridge === "boolean") state.audioBridge = p.audioBridge;
      if (p.targetClips && p.targetClips > 0) state.targetClips = p.targetClips;
    } catch (e) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          aspect: state.aspect,
          resolution: state.resolution,
          followAlong: state.followAlong,
          autoSave: state.autoSave,
          autoProduce: state.autoProduce,
          audioBridge: state.audioBridge,
          targetClips: state.targetClips,
        })
      );
    } catch (e) {}
  }

  /** Aspect locked on the beat / project — still and video must match (no lanky stretch). */
  function effectiveAspect(seg) {
    if (seg && seg.aspect) return seg.aspect;
    if (state.project && state.project.aspect) return state.project.aspect;
    return state.aspect || "16:9";
  }

  function parseAspectRatio(aspect) {
    var parts = String(aspect || "16:9").split(":");
    var aw = parseFloat(parts[0]);
    var ah = parseFloat(parts[1]);
    if (!(aw > 0) || !(ah > 0)) {
      aw = 16;
      ah = 9;
    }
    return { w: aw, h: ah, ratio: aw / ah };
  }

  function syncCinemaAspect(aspect) {
    aspect = aspect || effectiveAspect();
    var a = parseAspectRatio(aspect);
    var cinema = $("mv-cinema");
    if (!cinema) return;
    cinema.style.setProperty("--mv-ar", a.w + " / " + a.h);
    cinema.dataset.aspect = aspect;
    // Portrait: narrow the stage so letterboxing isn't a tall empty strip
    if (a.ratio < 1) {
      var h = cinema.clientHeight || 400;
      var w = Math.round(h * a.ratio);
      cinema.style.width = Math.min(w, cinema.parentElement ? cinema.parentElement.clientWidth : w) + "px";
      cinema.style.maxWidth = "100%";
    } else {
      cinema.style.width = "100%";
    }
  }

  /**
   * Fit still into target aspect without stretching (letterbox).
   * Prevents 16:9 stills being forced into 9:16 video frames.
   */
  function prepareReferenceForAspect(dataUrl, aspect, maxSide, quality) {
    return new Promise(function (resolve) {
      if (!dataUrl || dataUrl.indexOf("data:image") !== 0) return resolve(dataUrl || "");
      var a = parseAspectRatio(aspect);
      var img = new Image();
      img.onload = function () {
        var iw = Math.max(1, img.width || 1);
        var ih = Math.max(1, img.height || 1);
        var tw;
        var th;
        if (a.ratio >= 1) {
          tw = maxSide;
          th = Math.max(1, Math.round(maxSide / a.ratio));
        } else {
          th = maxSide;
          tw = Math.max(1, Math.round(maxSide * a.ratio));
        }
        var canvas = document.createElement("canvas");
        canvas.width = tw;
        canvas.height = th;
        var ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, tw, th);
        var scale = Math.min(tw / iw, th / ih);
        var dw = iw * scale;
        var dh = ih * scale;
        ctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function audioBridgeFor(seg) {
    if (!seg || !state.project) return "";
    var prev = seg.index > 0 ? state.project.segments[seg.index - 1] : null;
    var next =
      seg.index < state.project.segments.length - 1
        ? state.project.segments[seg.index + 1]
        : null;
    var lines = [];
    if (seg.audioBridge) lines.push("THIS BEAT AUDIO: " + String(seg.audioBridge).trim());
    if (prev && (prev.audioBridge || prev.motion || prev.dialogue || prev.script)) {
      lines.push(
        "CONTINUE FROM PREVIOUS BEAT (no hard audio cut): " +
          String(prev.audioBridge || prev.dialogue || prev.motion || prev.script || "").slice(
            0,
            280
          )
      );
    }
    if (next && (next.audioBridge || next.dialogue || next.script || next.motion)) {
      lines.push(
        "LEAVE ROOM TO BLEND INTO NEXT BEAT: " +
          String(next.audioBridge || next.dialogue || next.motion || next.script || "").slice(
            0,
            280
          )
      );
    }
    if (seg.dialogue) {
      lines.push(
        "OPTIONAL HALF-HEARD DIALOGUE (texture under the bed, not karaoke): " +
          clipPhrase(String(seg.dialogue).replace(/\n+/g, " / "), 400)
      );
    }
    lines.push(
      "AUDIO: continuous cinematic bed — soft room tone / atmosphere that can crossfade; avoid abrupt silence or one-shot stingers at the end."
    );
    return lines.join("\n");
  }

  function persistProject() {
    if (!state.project) return;
    try {
      var copy = JSON.parse(JSON.stringify(state.project));
      if (copy.segments) {
        copy.segments.forEach(function (s) {
          if (s.playUrl && String(s.playUrl).indexOf("blob:") === 0) s.playUrl = s.videoUrl || "";
        });
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
    } catch (e) {
      /* quota */
    }
  }

  function loadProject() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // migrate v1 if present
        raw = localStorage.getItem("movie-project-v1");
      }
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || !Array.isArray(p.segments)) return null;
      p.segments.forEach(function (seg) {
        migrateSegmentSources(seg);
      });
      return p;
    } catch (e) {
      return null;
    }
  }

  function normalizeSource(item) {
    item = item || {};
    var url = item.url || "";
    var paintingNum =
      item.paintingNum != null
        ? item.paintingNum
        : item.number != null
          ? item.number
          : null;
    if (paintingNum != null) paintingNum = parseInt(paintingNum, 10) || null;
    var lod1Num = item.lod1Num != null ? parseInt(item.lod1Num, 10) || null : null;
    if (!lod1Num && url) {
      var m = String(url).match(/\/generated\/(\d+)\./i);
      if (m) lod1Num = parseInt(m[1], 10);
    }
    return {
      id: item.id || url || String(paintingNum || lod1Num || Math.random()),
      url: url,
      label: item.label || item.title || item.name || "",
      paintingNum: paintingNum,
      lod1Num: lod1Num,
      source: item.source || item.collection || "unknown",
    };
  }

  function dedupePool(pool) {
    var seen = {};
    return pool.filter(function (item) {
      var key = item.url || item.id;
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function fetchAcquiredFolder(folderId) {
    return fetchWithTimeout(
      apiUrl("/api/acquired-images?folder=" + encodeURIComponent(folderId)),
      { cache: "no-store" },
      30000
    )
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d || !d.files) return [];
        return d.files.map(function (f) {
          return normalizeSource({
            url: f.url,
            label: f.name || folderId,
            source: folderId,
          });
        });
      })
      .catch(function () {
        return [];
      });
  }

  function fetchAssetCollection(collection) {
    return fetchWithTimeout(
      apiUrl("/api/gallery-assets?collection=" + encodeURIComponent(collection) + "&t=" + Date.now()),
      { cache: "no-store" },
      45000
    )
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d || !Array.isArray(d.items)) return [];
        return d.items.map(function (item) {
          return normalizeSource({
            id: item.id,
            url: item.url,
            label: item.title || item.subtitle || item.entity_name || collection,
            paintingNum: null,
            number: item.number,
            source: collection,
            lod1Num: collection === "generated" ? item.number : null,
          });
        });
      })
      .catch(function () {
        return [];
      });
  }

  function loadLod1AnalysesQuiet() {
    return fetchWithTimeout(apiUrl("/api/lod1-analyses?t=" + Date.now()), { cache: "no-store" }, 30000)
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && typeof d === "object") state.lod1Analyses = d;
      })
      .catch(function () {
        return fetch("data/lod1-analyses.json")
          .then(function (r) {
            return r.ok ? r.json() : {};
          })
          .then(function (d) {
            state.lod1Analyses = d || {};
          })
          .catch(function () {});
      });
  }

  function updatePoolHint() {
    var el = $("mv-pool-count");
    if (!el) return;
    if (!state.poolReady) {
      el.textContent = state.poolLoading ? "Loading film library…" : "Pool empty";
      return;
    }
    var stats = state.poolStats || {};
    var parts = [state.pool.length + " images"];
    Object.keys(stats).forEach(function (k) {
      if (stats[k]) parts.push(k + " " + stats[k]);
    });
    el.textContent = parts.join(" · ");
  }

  /**
   * Full film library: 1000 paintings + generated + characters + objects + places +
   * stasis + fallout + acquired lod1s / saved folders.
   */
  function loadPool() {
    if (state.poolReady && state.pool.length) return Promise.resolve(state.pool);
    if (state.poolLoading) {
      return new Promise(function (resolve) {
        var tick = setInterval(function () {
          if (!state.poolLoading) {
            clearInterval(tick);
            resolve(state.pool);
          }
        }, 100);
      });
    }
    state.poolLoading = true;
    setStatus("Loading film library (paintings + generated + assets)…", "pending");
    updatePoolHint();

    var galleryPromise = window.loadGalleryData
      ? window.loadGalleryData()
      : Promise.resolve({ manifest: [], analyses: {} });

    return Promise.all([galleryPromise, loadLod1AnalysesQuiet()])
      .then(function (results) {
        var data = results[0] || {};
        var manifest =
          data.manifest ||
          (window.getGalleryManifest && window.getGalleryManifest()) ||
          window.galleryManifest ||
          [];
        state.analyses = data.analyses || state.analyses || window.galleryAnalyses || {};

        var pool = [];
        var stats = { paintings: 0 };

        manifest.forEach(function (m) {
          var num = m.number != null ? m.number : m.num != null ? m.num : parseInt(m.id, 10);
          if (!num || !isFinite(num)) return;
          pool.push(
            normalizeSource({
              url: paintingUrl(num),
              label: "#" + num,
              paintingNum: num,
              source: "paintings",
            })
          );
          stats.paintings++;
        });

        var assetJobs = ASSET_COLLECTIONS.map(function (c) {
          return fetchAssetCollection(c).then(function (list) {
            stats[c] = list.length;
            return list;
          });
        });

        var acquiredIndex = fetchWithTimeout(apiUrl("/api/acquired-images"), { cache: "no-store" }, 20000)
          .then(function (r) {
            return r.ok ? r.json() : { folders: [] };
          })
          .catch(function () {
            return { folders: [] };
          });

        return Promise.all([Promise.all(assetJobs), acquiredIndex]).then(function (pair) {
          pair[0].forEach(function (list) {
            pool = pool.concat(list);
          });

          var folders = ["lod1s", "saved-stasis"];
          (pair[1].folders || []).forEach(function (f) {
            if (f.id === "saved-fallout" && f.children) {
              f.children.forEach(function (c) {
                folders.push(c.id);
              });
            } else if (f.id && f.id !== "saved-fallout" && folders.indexOf(f.id) < 0) {
              // also pick up any other acquired folders with images
              if (f.id.indexOf("saved") === 0 || f.id === "lod1s") folders.push(f.id);
            }
          });
          // unique folders
          folders = folders.filter(function (f, i, a) {
            return a.indexOf(f) === i;
          });

          return Promise.all(folders.map(fetchAcquiredFolder)).then(function (chunks) {
            chunks.forEach(function (list, i) {
              var fid = folders[i];
              stats[fid] = (stats[fid] || 0) + list.length;
              pool = pool.concat(list);
            });
            state.pool = dedupePool(pool).filter(function (p) {
              return !!p.url;
            });
            state.poolStats = stats;
            state.poolReady = state.pool.length > 0;
            state.poolLoading = false;
            updatePoolHint();
            setStatus(
              state.poolReady
                ? "Film library ready — " +
                    state.pool.length +
                    " images (paintings, generated, characters, objects, places, stasis…)."
                : "Pool empty — run start_server.bat so asset folders can be scanned.",
              state.poolReady ? "ok" : "error"
            );
            return state.pool;
          });
        });
      })
      .catch(function (err) {
        state.poolLoading = false;
        state.poolReady = state.pool.length > 0;
        updatePoolHint();
        setStatus(
          "Could not load full film library: " + ((err && err.message) || err),
          "error"
        );
        return state.pool;
      });
  }

  function pickRandomSources(count) {
    count = count || SOURCES_PER_CLIP;
    if (!state.pool.length) return [];
    var bag = state.pool.slice();
    var out = [];
    var i;
    for (i = 0; i < count && bag.length; i++) {
      var idx = Math.floor(Math.random() * bag.length);
      out.push(normalizeSource(bag[idx]));
      bag.splice(idx, 1);
    }
    return out;
  }

  function paintingNumsFromSources(sources) {
    var nums = [];
    (sources || []).forEach(function (s) {
      if (s.paintingNum && nums.indexOf(s.paintingNum) < 0) nums.push(s.paintingNum);
    });
    return nums;
  }

  function sourceBlurb(src) {
    src = normalizeSource(src);
    if (src.paintingNum) {
      var a = getAnalysis(src.paintingNum);
      if (a) {
        var bits = [];
        if (a.title) bits.push('"' + a.title + '"');
        if (a.description) bits.push(String(a.description).slice(0, 200));
        else if (a.style) bits.push(a.style);
        return (
          "Painting #" +
          src.paintingNum +
          (bits.length ? ": " + bits.join(" — ") : "") +
          " [source: paintings]"
        );
      }
      return "Painting #" + src.paintingNum + " [source: paintings]";
    }
    if (src.lod1Num) {
      var l = getLod1Analysis(src.lod1Num);
      if (l) {
        var lb = [];
        if (l.title) lb.push('"' + l.title + '"');
        if (l.description) lb.push(String(l.description).slice(0, 200));
        return (
          "Generated LOD1 #" +
          src.lod1Num +
          (lb.length ? ": " + lb.join(" — ") : "") +
          " [source: " +
          (src.source || "generated") +
          "]"
        );
      }
      return "Generated #" + src.lod1Num + " [source: " + (src.source || "generated") + "]";
    }
    return (
      (src.label || "Image") +
      " [source: " +
      (src.source || "asset") +
      "]" +
      (src.url ? " · " + src.url : "")
    );
  }

  function analysisForSource(src) {
    src = normalizeSource(src);
    if (src.paintingNum) return getAnalysis(src.paintingNum) || null;
    if (src.lod1Num) return getLod1Analysis(src.lod1Num) || null;
    return null;
  }

  function clipPhrase(text, maxLen) {
    text = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    if (text.length <= maxLen) return text;
    return text.slice(0, Math.max(0, maxLen - 1)).trim() + "…";
  }

  /** Hard clamp for API prompt fields (prefer UTF-8 byte length when available). */
  function clampToApiPrompt(text, maxBytes) {
    maxBytes = maxBytes != null ? maxBytes : PROMPT_MAX;
    text = String(text || "").trim();
    if (!text) return "";
    if (typeof TextEncoder !== "undefined") {
      var enc = new TextEncoder();
      if (enc.encode(text).length <= maxBytes) return text;
      var lo = 0;
      var hi = text.length;
      while (lo < hi) {
        var mid = Math.floor((lo + hi + 1) / 2);
        if (enc.encode(text.slice(0, mid)).length <= maxBytes - 3) lo = mid;
        else hi = mid - 1;
      }
      return text.slice(0, lo).replace(/\s+\S*$/, "").trim() + "…";
    }
    if (text.length <= maxBytes) return text;
    return text.slice(0, Math.max(0, maxBytes - 1)).trim() + "…";
  }

  function shortSourceLine(src) {
    src = normalizeSource(src);
    var a = analysisForSource(src);
    var label =
      src.paintingNum != null
        ? "#" + src.paintingNum
        : src.lod1Num != null
          ? "G#" + src.lod1Num
          : src.label || src.source || "spell";
    if (a && a.title) return label + ' "' + clipPhrase(a.title, 48) + '"';
    if (a && a.description) return label + ": " + firstSentence(a.description, 80);
    return label;
  }

  function firstSentence(text, maxLen) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    var m = text.match(/^(.{12,160}?[.!?])(\s|$)/);
    var s = m ? m[1] : text;
    return clipPhrase(s, maxLen || 140);
  }

  function pickOne(arr) {
    if (!arr || !arr.length) return "";
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function fillTemplate(tpl, map) {
    return String(tpl || "").replace(/\{([a-z0-9]+)\}/gi, function (_, key) {
      return map[key] != null && map[key] !== "" ? map[key] : "";
    });
  }

  /**
   * Pull title / description / style / medium hooks from a spell source for imaginative scripts.
   */
  function spellPersona(src, fallbackIndex) {
    src = normalizeSource(src);
    var a = analysisForSource(src) || {};
    var label =
      src.paintingNum != null
        ? "#" + src.paintingNum
        : src.lod1Num != null
          ? "G#" + src.lod1Num
          : src.label || src.source || "spell";
    var title =
      a.title ||
      src.label ||
      (src.paintingNum != null
        ? "Painting " + src.paintingNum
        : src.lod1Num != null
          ? "Vision " + src.lod1Num
          : "Untitled spell " + (fallbackIndex + 1));
    var desc = firstSentence(a.description || a.summary || "", 150);
    var style = clipPhrase(a.style || a.movement || a.genre || "", 60);
    var medium = clipPhrase(a.medium || a.materials || "", 50);
    var colors = "";
    if (Array.isArray(a.colors) && a.colors.length) {
      colors = a.colors
        .slice(0, 3)
        .map(function (c) {
          return typeof c === "string" ? c : c && c.name ? c.name : "";
        })
        .filter(Boolean)
        .join(", ");
    } else if (a.palette) {
      colors = clipPhrase(a.palette, 60);
    }
    var tags = "";
    if (Array.isArray(a.tags) && a.tags.length) {
      tags = a.tags.slice(0, 4).join(", ");
    } else if (Array.isArray(a.keywords)) {
      tags = a.keywords.slice(0, 4).join(", ");
    }
    var hook =
      desc ||
      (style ? style + " atmosphere" : "") ||
      (colors ? "palette of " + colors : "") ||
      (tags ? tags : "") ||
      "raw gallery spell energy from " + label;
    hook = clipPhrase(hook, 160);
    return {
      label: label,
      title: clipPhrase(title, 80),
      desc: desc ? desc : "its private weather still unknown",
      style: style || "painterly",
      medium: medium || "oil-and-light",
      colors: colors || "uncertain hues",
      tags: tags,
      hook: hook,
      source: src.source || "gallery",
    };
  }

  function soundPaletteForPersona(p) {
    p = p || {};
    var blob = [p.style, p.hook, p.title, p.tags, p.desc, p.medium].join(" ");
    var i;
    for (i = 0; i < SOUND_FROM_STYLE.length; i++) {
      if (SOUND_FROM_STYLE[i].re.test(blob)) return SOUND_FROM_STYLE[i].s;
    }
    // Fall back to mood-tinted generic-but-specific texture from the hook
    if (p.hook) {
      return (
        "soft noise sculpted like: " +
        clipPhrase(p.hook, 90) +
        " — more air than melody"
      );
    }
    return "low drone, bristle grain, distant weather without location";
  }

  function pickN(arr, n) {
    var bag = (arr || []).slice();
    var out = [];
    var i;
    for (i = 0; i < n && bag.length; i++) {
      var idx = Math.floor(Math.random() * bag.length);
      out.push(bag[idx]);
      bag.splice(idx, 1);
    }
    return out;
  }

  function tidyLines(text) {
    return String(text || "")
      .replace(/[ \t]+/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
  }

  /** Multi-line motion direction rooted in the three spells — not a single bland sentence. */
  function composeImaginativeMotion(map) {
    var parts = [];
    parts.push(fillTemplate(pickOne(MOTION_OPENERS), map));
    pickN(MOTION_KINETICS, 2 + (Math.random() < 0.5 ? 1 : 0)).forEach(function (t) {
      parts.push(fillTemplate(t, map));
    });
    pickN(MOTION_SPELL_BEATS, 2).forEach(function (t) {
      parts.push(fillTemplate(t, map));
    });
    parts.push(fillTemplate(pickOne(MOTION_CLOSERS), map));
    parts.push(
      "Spell motion DNA: " +
        map.label0 +
        " “" +
        map.title0 +
        "” · " +
        map.label1 +
        " “" +
        map.title1 +
        "” · " +
        map.label2 +
        " “" +
        map.title2 +
        "”."
    );
    return tidyLines(parts.join(" "));
  }

  /** Multi-layer audio bridge: bed + per-spell layers + handoff for the next 10s. */
  function composeImaginativeAudio(map) {
    var parts = [];
    parts.push(fillTemplate(pickOne(AUDIO_OPENERS), map));
    parts.push(fillTemplate(pickOne(AUDIO_BEDS), map));
    pickN(AUDIO_SPELL_LAYERS, 3).forEach(function (t) {
      parts.push(fillTemplate(t, map));
    });
    parts.push(fillTemplate(pickOne(AUDIO_BRIDGES), map));
    parts.push(
      "Do not invent a new scene in sound — sonify the still of “" +
        map.title0 +
        "” / “" +
        map.title1 +
        "” / “" +
        map.title2 +
        "” under act \"" +
        map.act +
        "\" (" +
        map.mood +
        ")."
    );
    return tidyLines(parts.join(" "));
  }

  function randomSurname() {
    var core = pickOne(LAST_NAMES) || "Voss";
    var prefix = pickOne(SURNAME_PREFIXES);
    var suffix = pickOne(SURNAME_SUFFIXES);
    // Avoid ugly combos like Mc + son or O' + -Cross
    if (prefix === "O'" || prefix === "Mc" || prefix === "Mac") {
      suffix = "";
      if (prefix === "O'") return prefix + core;
      return prefix + core.charAt(0).toUpperCase() + core.slice(1).toLowerCase();
    }
    if (suffix === "son" && /s$/i.test(core)) suffix = "son";
    if (suffix === "s" && /s$/i.test(core)) suffix = "";
    if (suffix.indexOf("-") === 0 && Math.random() < 0.5) {
      return core + suffix + (pickOne(LAST_NAMES) || "Vale");
    }
    return (prefix || "") + core + (suffix === "son" || suffix === "s" ? suffix : suffix || "");
  }

  function randomFullName(used) {
    used = used || {};
    var tries = 0;
    var name = "";
    do {
      var first = pickOne(FIRST_NAMES) || "Eden";
      var last = randomSurname();
      name = first + " " + last;
      tries++;
    } while (used[name] && tries < 40);
    used[name] = true;
    return name;
  }

  function castCharacters(count) {
    count = count || 2 + (Math.random() < 0.55 ? 1 : 0);
    count = Math.max(2, Math.min(4, count));
    var used = {};
    var cast = [];
    var i;
    for (i = 0; i < count; i++) {
      cast.push(randomFullName(used));
    }
    return cast;
  }

  /**
   * Play-format dialogue rooted in spell DNA — names are random; content cites spell worlds.
   * Stage directions in parentheses; CHARACTER in caps like a book script.
   */
  function composeImaginativeDialogue(map) {
    var cast = castCharacters(2 + (Math.random() < 0.45 ? 1 : 0));
    var a = cast[0];
    var b = cast[1];
    var c = cast[2] || cast[0];
    var aUp = a.toUpperCase();
    var bUp = b.toUpperCase();
    var cUp = c.toUpperCase();

    var linesA = [
      "I keep seeing “{title0}” when I close my eyes — {hook0}. Tell me you see it too.",
      "If we step any closer to “{title1}”, we stop being visitors. We become {mood} weather.",
      "They hung three spells in one frame and called it mercy. I call it a trial.",
      "Listen: the paint of “{title0}” is still wet with {style0}. That means it can still choose us.",
      "I did not come through a door. I came through {hook0} — the same way a brush comes through oil.",
      "Name yourself before the light of “{title2}” does. {hook2}.",
    ];
    var linesB = [
      "Then we are already inside “{title1}”. {desc1} There is no outside left to run to.",
      "Do not quote the gallery at me. Quote what the pigment wants — {hook1}.",
      "In {act}, everyone swears they were only watching. Watching is how the frame eats you.",
      "Your voice sounds like {medium0} dragged across {medium1}. Soft. Dangerous.",
      "I loved someone once in a painting called “{title0}”. They never learned my surname.",
      "If this is a dream, why does “{title2}” smell like {colors2}?",
    ];
    var linesC = [
      "(aside)\nThe third spell never speaks until the lovers have already ruined the composition.",
      "I am the witness from “{title2}”. {hook2} I do not save. I record.",
      "Court is in session under a sky stolen from “{title1}”. Verdict is color, not law.",
      "Say the titles like vows: “{title0}.” “{title1}.” “{title2}.” Now mean them.",
      "(quiet)\nIf you leave the still, you leave each other. The frame is the only marriage left.",
    ];
    var exchanges = [
      [
        aUp + "\n" + fillTemplate(pickOne(linesA), map),
        bUp + "\n" + fillTemplate(pickOne(linesB), map),
        aUp + "\nThen stay. One more breath inside {hook0}. One more lie that looks like light.",
        bUp + "\nOne more truth that looks like “{title2}”.",
      ],
      [
        aUp + "\n(half to self)\nThey will ask what we saw. I will say “{title0}” and they will not believe the rest.",
        bUp + "\nLet them not believe. Belief is cheap. {style1} is expensive.",
        cUp + "\n" + fillTemplate(pickOne(linesC), map),
        aUp + "\nWho are you?",
        cUp + "\nA surname the spells invented. You may call me what the frame calls weather.",
      ],
      [
        bUp + "\nHold my hand like a contour line.",
        aUp + "\nIf I hold you, I drag you into “{title1}”. {hook1}",
        bUp + "\nGood. I was tired of clean air.",
        aUp + "\nThen speak the third spell with me — “{title2}” — before the ten seconds end.",
      ],
      [
        aUp + "\nThey put us on trial for entering a painting.",
        bUp + "\nNo. For leaving three unfinished.",
        aUp + "\n“{title0}.” “{title1}.” “{title2}.”",
        bUp + "\n(soft)\nGuilty of wonder. Sentence: stay visible.",
        cUp + "\n" + fillTemplate(pickOne(linesC), map),
      ],
      [
        aUp + "\nRomeo had a balcony. We have a brushstroke from “{title0}”.",
        bUp + "\nThen climb. But if you fall, fall into “{title1}”, not into silence.",
        aUp + "\nAnd if the town calls us witches for hearing pigment speak?",
        bUp + "\nThen we answer in {style0} and {style1}. Not in apology.",
      ],
    ];

    var block = pickOne(exchanges);
    var body = block
      .map(function (line) {
        return fillTemplate(line, map);
      })
      .join("\n\n");

    var header =
      "DIALOGUE — Act " +
      map.act +
      ", Beat " +
      map.n +
      "\n" +
      "Cast: " +
      cast.join("; ") +
      "\n" +
      "Spell chorus: “" +
      map.title0 +
      "” · “" +
      map.title1 +
      "” · “" +
      map.title2 +
      "”\n" +
      "(Voices may be spoken, whispered, or only half-heard under the audio bed — keep language natural, specific, spell-haunted.)\n";

    return tidyLines(header + "\n" + body);
  }

  /**
   * Build a vivid beat: scene (visual) + dialogue (play text) + motion + audio from spells.
   */
  function composeImaginativeBeat(index, total, sourcesOpt) {
    total = total || FULL_HOUR_CLIPS;
    var sources =
      sourcesOpt && sourcesOpt.length
        ? sourcesOpt.map(normalizeSource)
        : pickRandomSources(SOURCES_PER_CLIP);
    while (sources.length < 3 && state.pool.length) {
      var extra = pickRandomSources(1);
      if (!extra.length) break;
      if (
        !sources.some(function (s) {
          return s.url && s.url === extra[0].url;
        })
      ) {
        sources.push(extra[0]);
      } else break;
    }
    if (!sources.length) {
      sources = pickRandomSources(SOURCES_PER_CLIP);
    }

    var p0 = spellPersona(sources[0] || {}, 0);
    var p1 = spellPersona(sources[1] || sources[0] || {}, 1);
    var p2 = spellPersona(sources[2] || sources[0] || {}, 2);
    var act =
      ACT_TITLES[Math.floor((index / Math.max(1, total)) * ACT_TITLES.length)] ||
      pickOne(ACT_TITLES) ||
      "Wander";
    // Nudge act with a little randomness so 360 pages aren't a rigid ladder only
    if (Math.random() < 0.35) act = pickOne(ACT_TITLES) || act;
    var mood = pickOne(MOOD_WORDS) || "uncanny";
    var map = {
      n: String(index + 1),
      act: act,
      mood: mood,
      label0: p0.label,
      label1: p1.label,
      label2: p2.label,
      title0: p0.title,
      title1: p1.title,
      title2: p2.title,
      desc0: p0.desc,
      desc1: p1.desc,
      desc2: p2.desc,
      style0: p0.style,
      style1: p1.style,
      style2: p2.style,
      medium0: p0.medium,
      medium1: p1.medium,
      medium2: p2.medium,
      colors0: p0.colors,
      colors1: p1.colors,
      colors2: p2.colors,
      tags0: p0.tags || p0.style,
      tags1: p1.tags || p1.style,
      tags2: p2.tags || p2.style,
      hook0: p0.hook,
      hook1: p1.hook,
      hook2: p2.hook,
      sound0: soundPaletteForPersona(p0),
      sound1: soundPaletteForPersona(p1),
      sound2: soundPaletteForPersona(p2),
    };

    // Scene = stage picture only (what we see). Dialogue = play script with names.
    var script = tidyLines(fillTemplate(pickOne(SCENE_TEMPLATES), map));
    script +=
      "\n\nSpell DNA: " +
      [p0, p1, p2]
        .map(function (p) {
          return p.label + " “" + p.title + "”";
        })
        .join(" · ") +
      ".";

    var dialogue = composeImaginativeDialogue(map);
    var motion = composeImaginativeMotion(map);
    var audioBridge = composeImaginativeAudio(map);

    return {
      index: index,
      page: index + 1,
      act: act,
      sources: sources,
      spells: paintingNumsFromSources(sources),
      script: script,
      dialogue: dialogue,
      motion: motion,
      audioBridge: audioBridge,
      aspect: state.aspect || "16:9",
      imageUrl: "",
      videoUrl: "",
      playUrl: "",
      savedName: "",
      status: "queued",
      error: "",
      mood: mood,
    };
  }

  function migrateSegmentSources(seg) {
    if (!seg) return seg;
    if (seg.page == null) seg.page = (seg.index != null ? seg.index : 0) + 1;
    if (!seg.script) seg.script = "";
    if (seg.dialogue == null) seg.dialogue = "";
    if (!seg.audioBridge) {
      seg.audioBridge =
        "Soft continuous atmosphere that can crossfade into the next beat.";
    }
    if (!seg.aspect) seg.aspect = (state.project && state.project.aspect) || state.aspect || "16:9";
    if (seg.sources && seg.sources.length) {
      seg.sources = seg.sources.map(normalizeSource);
      seg.spells = paintingNumsFromSources(seg.sources);
      return seg;
    }
    if (seg.spells && seg.spells.length) {
      seg.sources = seg.spells.map(function (n) {
        return normalizeSource({
          url: paintingUrl(n),
          label: "#" + n,
          paintingNum: n,
          source: "paintings",
        });
      });
      return seg;
    }
    seg.sources = [];
    seg.spells = [];
    return seg;
  }

  function ensureSegmentSources(seg) {
    migrateSegmentSources(seg);
    if (!seg.sources || !seg.sources.length) {
      seg.sources = pickRandomSources(SOURCES_PER_CLIP);
      seg.spells = paintingNumsFromSources(seg.sources);
    }
    // drop sources with no url
    seg.sources = (seg.sources || []).filter(function (s) {
      return s && s.url;
    });
    if (!seg.sources.length && state.pool.length) {
      seg.sources = pickRandomSources(SOURCES_PER_CLIP);
    }
    seg.spells = paintingNumsFromSources(seg.sources);
    return seg;
  }

  function sourcesLabel(seg) {
    ensureSegmentSources(seg);
    return (seg.sources || [])
      .map(function (s) {
        if (s.paintingNum) return "#" + s.paintingNum;
        if (s.lod1Num) return "G#" + s.lod1Num;
        return s.source || s.label || "?";
      })
      .join(", ");
  }

  function buildSegmentStasis(seg) {
    ensureSegmentSources(seg);
    var aspect = effectiveAspect(seg);
    var cont = !!(seg.continueScene || seg.continuityRef);
    var lines = [
      cont
        ? "CONTINUATION still · NOT a new intro · beat " +
          (seg.index + 1) +
          " · aspect " +
          aspect +
          ". Same world/subjects as the attached last frame — evolve the moment."
        : "MOVIE still · beat " +
          (seg.index + 1) +
          " · act " +
          (seg.act || "Wander") +
          " · aspect " +
          aspect +
          " (exact frame; no stretch).",
    ];
    if (cont) {
      lines.push(
        "CRITICAL: Start from the reference frame (previous video last frame / prior still). " +
          "Do NOT restart composition, wardrobe, or location like a cold open. Escalate the exchange."
      );
    }
    if (seg.script) {
      lines.push("SCENE: " + clipPhrase(String(seg.script).replace(/\n+/g, " "), cont ? 500 : 700));
    }
    if (seg.lastArtReply) {
      lines.push(
        "Next beat of the dialogue in the image mood: “" +
          clipPhrase(seg.lastArtReply, 180) +
          "”"
      );
    }
    if (seg.dialogue) {
      lines.push(
        "MOOD from recent dialogue (no painted text): " +
          clipPhrase(String(seg.dialogue).replace(/\n+/g, " / "), cont ? 220 : 350)
      );
    }
    if (!cont) {
      lines.push("Fuse sources into ONE scene (no collage, no text/watermark):");
      (seg.sources || []).slice(0, 3).forEach(function (s) {
        lines.push("• " + shortSourceLine(s));
      });
    } else {
      lines.push("Spells only tint style — keep identity of the attached frame.");
    }
    return clampToApiPrompt(lines.join("\n"), STASIS_MAX);
  }

  function buildSegmentPrompt(seg) {
    ensureSegmentSources(seg);
    var aspect = effectiveAspect(seg);
    var cont = !!(seg.continueScene || seg.continuityRef);
    var base;
    if (cont) {
      base =
        "CONTINUE the attached last frame into the next moment of the same scene. " +
        "Same people/place/lighting grammar. " +
        (seg.lastHeard
          ? "Visitor just said: “" + clipPhrase(seg.lastHeard, 120) + "”. "
          : "") +
        (seg.lastArtReply
          ? "Art answers (mood): “" + clipPhrase(seg.lastArtReply, 140) + "”. "
          : "") +
        "Raise the stakes — not a reset intro shot.";
    } else {
      base =
        seg.script && String(seg.script).trim()
          ? clipPhrase(String(seg.script).replace(/\n+/g, " "), 900)
          : "Cinematic beat " +
            (seg.index + 1) +
            " · " +
            (seg.act || "Wander") +
            " · " +
            sourcesLabel(seg) +
            ".";
    }
    var out =
      base +
      " Exact aspect " +
      aspect +
      ". One coherent frame, painterly, no readable text.";
    if (seg.dialogue && String(seg.dialogue).trim()) {
      out +=
        " Emotional undertone (no painted words): " +
        clipPhrase(String(seg.dialogue).replace(/\n+/g, " / "), 220);
    }
    return clampToApiPrompt(out, PROMPT_MAX);
  }

  function buildLifePrompt(seg) {
    var aspect = effectiveAspect(seg);
    var cont = !!(seg.continueScene || seg.continuityRef);
    var motionRaw = seg.motion || "";
    if (seg.lastArtReply && String(motionRaw).indexOf("ART'S RESPONSE") < 0) {
      motionRaw =
        "MOTION IS THE ART'S RESPONSE — perform: “" +
        clipPhrase(seg.lastArtReply, 180) +
        "”. " +
        motionRaw;
    }
    var motion = clipPhrase(String(motionRaw || MOTION_BEATS[0]).replace(/\n+/g, " "), 700);
    var scene = seg.script
      ? clipPhrase(String(seg.script).replace(/\n+/g, " "), 300)
      : "";
    var bridge = clipPhrase(String(audioBridgeFor(seg) || "").replace(/\n+/g, " "), 280);
    var lines = [
      cont
        ? "IMAGE-TO-LIFE — continue from this frame (it is the last moment of the prior clip). Same subjects/space. Aspect " +
          aspect +
          ". Fixed camera. Seamless " +
          CLIP_SEC +
          "s. NOT a new intro."
        : "IMAGE-TO-LIFE — animate attached still only. Same composition/palette. Aspect " +
          aspect +
          " exact. Fixed camera. Seamless " +
          CLIP_SEC +
          "s.",
      "PRIMARY MOTION (eventful dialogue beat): " + motion,
    ];
    if (seg.lastArtReply) {
      lines.push(
        "ART REPLY IN MOTION (not subtitles): “" + clipPhrase(seg.lastArtReply, 200) + "”"
      );
    }
    if (seg.exchangeTurn) {
      lines.push("Dialogue exchange #" + seg.exchangeTurn + " — escalate from prior beats.");
    }
    if (scene) lines.push("SCENE context: " + scene);
    if (bridge) lines.push(bridge);
    return clampToApiPrompt(lines.join("\n"), LIFE_PROMPT_MAX);
  }

  function emptySegment(index, total) {
    return composeImaginativeBeat(index, total || FULL_HOUR_CLIPS, null);
  }

  /** Re-roll imaginative scripts for every beat (keeps media if already generated). */
  function reseedScriptsFromSpells(opts) {
    opts = opts || {};
    if (!state.project || !state.project.segments) {
      return Promise.reject(new Error("No project to reseed."));
    }
    return loadPool().then(function () {
      if (!state.pool.length) {
        throw new Error("Film library empty — cannot seed from spells.");
      }
      var total = state.project.segments.length;
      state.project.segments.forEach(function (seg, i) {
        var keepMedia = opts.keepMedia !== false;
        var imageUrl = keepMedia ? seg.imageUrl : "";
        var videoUrl = keepMedia ? seg.videoUrl : "";
        var playUrl = keepMedia ? seg.playUrl : "";
        var status = keepMedia && videoUrl ? "ready" : keepMedia && imageUrl ? seg.status : "queued";
        var fresh = composeImaginativeBeat(i, total, null);
        seg.act = fresh.act;
        seg.sources = fresh.sources;
        seg.spells = fresh.spells;
        seg.script = fresh.script;
        seg.dialogue = fresh.dialogue;
        seg.motion = fresh.motion;
        seg.audioBridge = fresh.audioBridge;
        seg.mood = fresh.mood;
        seg.aspect = state.project.aspect || state.aspect || fresh.aspect;
        if (!keepMedia) {
          seg.imageUrl = "";
          seg.videoUrl = "";
          seg.playUrl = "";
          seg.status = "queued";
          seg.error = "";
        } else {
          seg.imageUrl = imageUrl || "";
          seg.videoUrl = videoUrl || "";
          seg.playUrl = playUrl || "";
          if (videoUrl) seg.status = "ready";
          else if (imageUrl && status) seg.status = status;
        }
      });
      persistProject();
      renderAll();
      setStatus(
        "Reseeded " +
          total +
          " scripts from spell DNA (titles, descriptions, styles).",
        "ok"
      );
      return state.project;
    });
  }

  function rollScript(targetClips) {
    targetClips = targetClips || state.targetClips || FULL_HOUR_CLIPS;
    if (!state.poolReady || !state.pool.length) {
      setStatus("Film library not ready yet — wait for pool load, or restart start_server.bat.", "error");
      return null;
    }
    var segments = [];
    var i;
    for (i = 0; i < targetClips; i++) {
      var seg = emptySegment(i, targetClips);
      seg.aspect = state.aspect || "16:9";
      segments.push(seg);
    }
    // Prefer Book scripts when present (Book is the authoring surface for the reel)
    if (window.Book && typeof window.Book.applyToSegments === "function") {
      try {
        window.Book.applyToSegments(segments, state.aspect);
      } catch (eBook) {}
    }
    state.project = {
      id: uuid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetClips: targetClips,
      clipSec: CLIP_SEC,
      aspect: state.aspect,
      resolution: state.resolution,
      segments: segments,
    };
    syncCinemaAspect(state.aspect);
    state.playIndex = 0;
    state.producing = false;
    state.produceAbort = false;
    persistProject();
    setStatus(
      "Script rolled — " +
        targetClips +
        " beats from " +
        state.pool.length +
        " images. " +
        (state.autoProduce ? "Starting production…" : "Hit Start production."),
      "ok"
    );
    renderAll();
    if (state.autoProduce) {
      setTimeout(function () {
        startProduction();
      }, 200);
    }
    return state.project;
  }

  function countByStatus(status) {
    if (!state.project) return 0;
    return state.project.segments.filter(function (s) {
      return s.status === status;
    }).length;
  }

  function readyCount() {
    if (!state.project) return 0;
    return state.project.segments.filter(function (s) {
      return s.status === "ready" && s.videoUrl;
    }).length;
  }

  function nextQueuedIndex() {
    if (!state.project) return -1;
    var i;
    for (i = 0; i < state.project.segments.length; i++) {
      var s = state.project.segments[i];
      if (
        s.status === "queued" ||
        s.status === "failed" ||
        s.status === "still" ||
        (s.status === "video" && !s.videoUrl)
      ) {
        // don't restart an in-flight still/video unless failed/queued
        if (s.status === "still" || s.status === "video") {
          if (state.producing && !s.error) {
            // leave currently producing segment alone if another is mid-flight — only pick first incomplete
          }
        }
        return i;
      }
    }
    return -1;
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
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function imageUrlToDataUrl(url) {
    if (!url) return Promise.resolve("");
    if (url.indexOf("data:") === 0) return Promise.resolve(url);
    var fetchUrl = fetchImageUrl(url);
    return fetch(fetchUrl)
      .then(function (r) {
        if (!r.ok) throw new Error("Image fetch failed (" + r.status + ")");
        return r.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () {
            resolve(reader.result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      });
  }

  function loadHtmlImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var src = fetchImageUrl(url);
      try {
        if (!isSameOriginUrl(src) && src.indexOf("data:") !== 0) img.crossOrigin = "anonymous";
      } catch (e) {}
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Could not load " + url));
      };
      img.src = src;
    });
  }

  /** Fuse source stills into one reference frame for the generator (no stretch). */
  function collageSources(sources, aspect) {
    sources = (sources || []).filter(function (s) {
      return s && s.url;
    });
    if (!sources.length) return Promise.resolve("");
    var parts = String(aspect || "16:9").split(":");
    var aw = parseFloat(parts[0]) || 16;
    var ah = parseFloat(parts[1]) || 9;
    var ratio = aw / ah;
    var W = REF_MAX_SIDE;
    var H = Math.max(1, Math.round(W / ratio));
    if (ratio < 1) {
      H = REF_MAX_SIDE;
      W = Math.max(1, Math.round(H * ratio));
    }

    return Promise.all(
      sources.map(function (s) {
        return loadHtmlImage(s.url).catch(function () {
          return null;
        });
      })
    ).then(function (imgs) {
      imgs = imgs.filter(Boolean);
      if (!imgs.length) return "";
      var canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext("2d");
      if (!ctx) return "";
      ctx.fillStyle = "#0a0908";
      ctx.fillRect(0, 0, W, H);

      // Contain (letterbox) into the TARGET aspect — never stretch sources into lanky frames
      function drawContain(img, alpha, ox, oy, scale) {
        var iw = img.width || 1;
        var ih = img.height || 1;
        var sc = Math.min(W / iw, H / ih) * (scale || 1);
        var dw = iw * sc;
        var dh = ih * sc;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, (W - dw) / 2 + (ox || 0), (H - dh) / 2 + (oy || 0), dw, dh);
        ctx.restore();
      }

      var n = imgs.length;
      if (n === 1) {
        drawContain(imgs[0], 1, 0, 0, 1);
      } else if (n === 2) {
        drawContain(imgs[0], 0.9, -W * 0.04, 0, 0.98);
        drawContain(imgs[1], 0.75, W * 0.04, 0, 0.95);
      } else {
        drawContain(imgs[0], 0.75, -W * 0.03, -H * 0.02, 1);
        drawContain(imgs[1], 0.65, W * 0.03, H * 0.02, 0.96);
        drawContain(imgs[2], 0.55, 0, 0, 0.9);
      }
      return canvas.toDataURL("image/jpeg", REF_QUALITY);
    });
  }

  function pollImageJob(jobId, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 100;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Still generation timed out."));
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 30000)
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        var st = job.status || "";
        setStatus(
          "Beat still job " + String(jobId).slice(0, 8) + "… (" + st + ")",
          "pending"
        );
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          var url = (img && img.url) || job.image_url || job.output_url || job.result_url;
          if (url) return absoluteUrl(url);
          throw new Error("No image URL in job result.");
        }
        if (job.status === "failed" || job.status === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Still failed.");
        }
        return delay(POLL_INTERVAL_MS).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1);
        });
      });
  }

  function generateStillLocal(seg) {
    ensureSegmentSources(seg);
    var nums = paintingNumsFromSources(seg.sources);
    var aspect = effectiveAspect(seg);
    if (window.composeStasisVisionLocal && nums.length >= 2) {
      return window
        .composeStasisVisionLocal({
          spells: nums,
          stasis: buildSegmentStasis(seg),
          buzz_words: ["movie", "cinematic", "follow-along", aspect],
          aspect_ratio: aspect,
        })
        .then(function (url) {
          if (!url) throw new Error("Local fuse returned empty.");
          return url;
        });
    }
    return collageSources(seg.sources, aspect).then(function (url) {
      if (!url) throw new Error("Could not build a local still from sources.");
      return url;
    });
  }

  function generateStillCloud(seg, refDataUrl) {
    ensureSegmentSources(seg);
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "mv-img-" + Date.now() + "-" + seg.index;
    var nums = paintingNumsFromSources(seg.sources);
    var aspect = effectiveAspect(seg);
    seg.aspect = aspect;
    var cont = !!(seg.continueScene || (refDataUrl && seg.continuityRef));
    var body = {
      job_id: jobId,
      stasis: buildSegmentStasis(seg),
      craft_hints: clampToApiPrompt(
        cont
          ? "CONTINUATION · same last frame · escalate dialogue beat · aspect " +
              aspect +
              " · no new intro · no text"
          : "Movie still · aspect " + aspect + " exact · one fused scene · no collage · no text",
        220
      ),
      buzz_words: cont
        ? ["continuation", "same scene", "next beat", "aspect " + aspect, "no text"]
        : ["movie", "cinematic", "aspect " + aspect, "no text"],
      spells: cont ? [] : nums,
      aspect_ratio: aspect,
      mag_fresh: !cont,
      fresh_variation: !cont,
      refine: cont,
      spell_cast: !cont && nums.length > 0,
      prompt: buildSegmentPrompt(seg),
    };
    if (refDataUrl && refDataUrl.indexOf("data:image") === 0) {
      body.reference_image = refDataUrl;
      body.spell_reference_image = refDataUrl;
    }

    return fetchWithTimeout(
      apiUrl("/api/generate-stasis-vision"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      FETCH_TIMEOUT_MS
    ).then(function (r) {
      if (r.status === 202) {
        return r.json().then(function (d) {
          return pollImageJob((d && d.job_id) || jobId);
        });
      }
      return parseApiResponse(r).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || "Still generate failed (" + r.status + ")");
        var img = d.image || (d.images && d.images[0]);
        if (img && img.url) return absoluteUrl(img.url);
        if (d.job_id) return pollImageJob(d.job_id);
        throw new Error("No image returned from generate-stasis-vision.");
      });
    });
  }

  function generateStill(seg) {
    ensureSegmentSources(seg);
    var aspect = effectiveAspect(seg);
    seg.aspect = aspect;
    syncCinemaAspect(aspect);

    // Prefer last-frame / continuity ref so talk turns don't re-intro the scene
    var contRef =
      seg.continuityRef && String(seg.continuityRef).indexOf("data:image") === 0
        ? seg.continuityRef
        : "";

    var refPromise;
    if (contRef) {
      refPromise = compressDataUrl(contRef, REF_MAX_SIDE, REF_QUALITY).then(function (c) {
        return c || contRef;
      });
    } else if (seg.continueScene && seg.imageUrl) {
      refPromise = imageUrlToDataUrl(
        seg.imageUrl.indexOf("data:") === 0 ? seg.imageUrl : absoluteUrl(seg.imageUrl)
      ).then(function (raw) {
        return compressDataUrl(raw, REF_MAX_SIDE, REF_QUALITY);
      });
    } else {
      if (!seg.sources.length) {
        return Promise.reject(new Error("No source images for this beat — reload the film library."));
      }
      refPromise = collageSources(seg.sources, aspect);
    }

    return refPromise
      .then(function (ref) {
        return generateStillCloud(seg, ref).catch(function (err) {
          setStatus(
            "Cloud still failed (" +
              ((err && err.message) || err) +
              ") — trying local fuse…",
            "pending"
          );
          return generateStillLocal(seg);
        });
      })
      .catch(function (err) {
        return generateStillLocal(seg).catch(function () {
          throw err;
        });
      });
  }

  function generateVideo(seg) {
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "mv-vid-" + Date.now() + "-" + seg.index;
    var aspect = effectiveAspect(seg);
    seg.aspect = aspect;
    var res = (state.project && state.project.resolution) || state.resolution;
    var imageUrl = seg.imageUrl;
    if (!imageUrl) return Promise.reject(new Error("No still for video."));

    var rawPromise =
      imageUrl.indexOf("data:") === 0
        ? Promise.resolve(imageUrl)
        : imageUrlToDataUrl(absoluteUrl(imageUrl));

    return rawPromise
      .then(function (raw) {
        // Letterbox into the beat's aspect — never stretch a wrong-ratio still into the video frame
        return prepareReferenceForAspect(raw, aspect, REF_MAX_SIDE, REF_QUALITY);
      })
      .then(function (compressed) {
        if (!compressed) throw new Error("Could not prepare still for animation.");
        // Keep stasis + life prompts separate and each under the 4096 API cap (never concatenate both).
        var lifePrompt = buildLifePrompt(seg);
        var stasisPrompt = buildSegmentStasis(seg);

        return fetchWithTimeout(
          apiUrl("/api/animate-cast"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wait: true,
              wait_for_result: true,
              job_id: jobId,
              stasis: stasisPrompt,
              prompt: lifePrompt,
              image_to_life_prompt: lifePrompt,
              craft_hints: clampToApiPrompt(
                "movie; 10s; fixed camera; same still; aspect " +
                  aspect +
                  "; soft audio crossfade",
                180
              ),
              buzz_words: [
                "movie",
                "image-to-life",
                "10s",
                "seamless loop",
                "aspect " + aspect,
                "audio continuity",
              ],
              beats: [
                { t: 0, text: "Match the still. Soft atmospheric bed." },
                { t: 3, text: "Internal motion only; continuous sound." },
                { t: 7, text: "Ease audio for crossfade into next beat." },
                { t: CLIP_SEC, text: "Return to still; soft audio tail." },
              ],
              duration: CLIP_SEC,
              spells: [],
              spell_cast: false,
              resolution: res,
              aspect_ratio: aspect,
              morph_chain: false,
              culmination: true,
              reference_image: compressed,
              spell_reference_image: compressed,
              image_url: imageUrl.indexOf("data:") === 0 ? "" : absoluteUrl(imageUrl),
            }),
          },
          VIDEO_WAIT_TIMEOUT_MS
        );
      })
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Video cast failed (" + r.status + ")");
          var vid = d.video;
          var url =
            (vid && (vid.url || vid.download_url || vid.uri)) ||
            d.video_url ||
            d.output_url ||
            d.result_url;
          if (url) return absoluteUrl(url);
          if (d.job_id) return pollVideoJob(d.job_id);
          throw new Error("No video returned for beat " + (seg.index + 1) + ".");
        });
      });
  }

  function pollVideoJob(jobId, startedAt) {
    startedAt = startedAt || Date.now();
    if (Date.now() - startedAt > VIDEO_WAIT_TIMEOUT_MS) {
      return Promise.reject(new Error("Video generation timed out."));
    }
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 30000)
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setStatus("Animating beat… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var vid = job.video;
          var url =
            (vid && (vid.url || vid.download_url || vid.uri)) ||
            job.video_url ||
            job.output_url ||
            job.result_url;
          if (url) return absoluteUrl(url);
          throw new Error("No video URL.");
        }
        if (job.status === "failed" || job.status === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Video failed.");
        }
        return delay(1000).then(function () {
          return pollVideoJob(jobId, startedAt);
        });
      });
  }

  function saveVideoToGallery(url) {
    if (!url || String(url).indexOf("data:") === 0) return Promise.resolve(null);
    // Browser blob: must upload bytes (server cannot fetch blob:)
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
          return fetchWithTimeout(
            apiUrl("/api/save-video"),
            { method: "POST", body: form },
            180000
          );
        })
        .then(function (r) {
          return parseApiResponse(r).then(function (d) {
            if (!r.ok) throw new Error((d && d.error) || "Save failed");
            return d;
          });
        })
        .catch(function (err) {
          console.warn("[movie] save blob failed", err);
          return null;
        });
    }
    return fetchWithTimeout(
      apiUrl("/api/save-video"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: absoluteUrl(url), force_mp4: true }),
      },
      180000
    )
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Save failed");
          return d;
        });
      })
      .catch(function (err) {
        console.warn("[movie] save failed", err);
        return null;
      });
  }

  function trackBlobUrl(url) {
    if (url && String(url).indexOf("blob:") === 0) state.blobUrls.push(url);
    return url;
  }

  function playUrlFor(url) {
    if (!url) return "";
    if (url.indexOf("data:") === 0 || url.indexOf("blob:") === 0) return url;
    // Prefer local saved-videos for direct playback
    if (String(url).indexOf("/saved-videos/") >= 0) return absoluteUrl(url);
    if (isSameOriginUrl(url)) return absoluteUrl(url);
    return mediaProxyUrl(url, "movie-clip.mp4");
  }

  function fetchVideoBlob(fetchUrl) {
    return fetchWithTimeout(
      fetchUrl,
      { cache: "no-store", credentials: "same-origin" },
      VIDEO_WAIT_TIMEOUT_MS
    ).then(function (r) {
      if (!r.ok) throw new Error("Video fetch failed (" + r.status + ")");
      var ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.indexOf("json") >= 0) {
        return r.json().then(function (j) {
          throw new Error((j && j.error) || "Video proxy returned JSON error.");
        });
      }
      if (ct.indexOf("text/html") >= 0) {
        throw new Error("Got HTML instead of video — is start_server.bat running?");
      }
      return r.blob();
    });
  }

  /**
   * Download clip bytes (proxy → direct) and build a blob: URL.
   * Remote xAI links often fail in <video src>; blobs play reliably.
   */
  function materializePlayback(sourceUrl) {
    sourceUrl = absoluteUrl(sourceUrl || "");
    if (!sourceUrl) return Promise.reject(new Error("No video URL."));
    if (sourceUrl.indexOf("blob:") === 0) {
      return Promise.resolve({ playUrl: sourceUrl, sourceUrl: sourceUrl, blob: null });
    }

    var candidates = [];
    function pushCand(u) {
      if (!u) return;
      if (candidates.indexOf(u) < 0) candidates.push(u);
    }
    if (String(sourceUrl).indexOf("/saved-videos/") >= 0) pushCand(absoluteUrl(sourceUrl));
    pushCand(mediaProxyUrl(sourceUrl, "movie-clip.mp4"));
    pushCand(playUrlFor(sourceUrl));
    pushCand(sourceUrl);

    function tryAt(i) {
      if (i >= candidates.length) {
        return Promise.reject(
          new Error(
            "Could not load video bytes. Restart start_server.bat, hard-refresh, and try Play reel again."
          )
        );
      }
      return fetchVideoBlob(candidates[i])
        .then(function (blob) {
          if (!blob || !blob.size) throw new Error("empty blob");
          var typed =
            blob.type && blob.type.indexOf("video") === 0
              ? blob
              : new Blob([blob], { type: "video/mp4" });
          var playUrl = trackBlobUrl(URL.createObjectURL(typed));
          return { playUrl: playUrl, sourceUrl: sourceUrl, blob: typed };
        })
        .catch(function () {
          return tryAt(i + 1);
        });
    }
    return tryAt(0);
  }

  /** Ensure segment has a playable blob (or stable local) URL. */
  function ensureSegmentPlayable(seg) {
    if (!seg || !seg.videoUrl) {
      return Promise.reject(new Error("No video on this beat."));
    }
    if (seg.playUrl && String(seg.playUrl).indexOf("blob:") === 0) {
      return Promise.resolve(seg.playUrl);
    }
    // Local saved-videos can stream directly, but blob is more reliable after refresh
    return materializePlayback(seg.videoUrl).then(function (playback) {
      seg.playUrl = playback.playUrl;
      // keep remote/local source on videoUrl for re-materialize later
      return playback.playUrl;
    });
  }

  function getPlayers() {
    return {
      a: $("mv-cinema-video"),
      b: $("mv-cinema-video-b"),
    };
  }

  function hideCinemaLayersExcept(which) {
    var img = $("mv-cinema-img");
    var players = getPlayers();
    var empty = $("mv-cinema-empty");
    if (empty) {
      empty.hidden = which !== "empty";
      empty.style.display = which === "empty" ? "flex" : "none";
    }
    if (img) {
      img.hidden = which !== "image";
      img.style.display = which === "image" ? "block" : "none";
    }
    var showVid = which === "video";
    [players.a, players.b].forEach(function (vid, i) {
      if (!vid) return;
      if (!showVid) {
        vid.hidden = true;
        vid.style.display = "none";
        try {
          vid.pause();
        } catch (e) {}
      }
    });
  }

  function rampVolume(vid, from, to, ms) {
    return new Promise(function (resolve) {
      if (!vid) return resolve();
      from = Math.max(0, Math.min(1, from));
      to = Math.max(0, Math.min(1, to));
      var steps = Math.max(4, Math.round(ms / 40));
      var i = 0;
      vid.volume = from;
      var t = setInterval(function () {
        i++;
        var u = i / steps;
        vid.volume = from + (to - from) * u;
        if (i >= steps) {
          clearInterval(t);
          vid.volume = to;
          resolve();
        }
      }, 40);
    });
  }

  function mountCinemaVideo(playSrc, seg, opts) {
    opts = opts || {};
    var players = getPlayers();
    var useB = state.activePlayer === "b";
    // When crossfading, incoming plays on the idle deck
    if (opts.crossfade) useB = state.activePlayer !== "b";
    var vid = useB ? players.b || players.a : players.a;
    var other = useB ? players.a : players.b;
    if (!vid || !playSrc) return Promise.resolve(false);

    syncCinemaAspect(effectiveAspect(seg));
    hideCinemaLayersExcept("video");
    vid.hidden = false;
    vid.style.display = "block";
    vid.style.opacity = opts.crossfade ? "0" : "1";
    vid.controls = true;
    vid.playsInline = true;
    vid.preload = "auto";
    vid.loop = false;
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");
    if (seg && seg.imageUrl && String(seg.imageUrl).indexOf("data:") !== 0) {
      try {
        vid.poster = absoluteUrl(seg.imageUrl);
      } catch (eP) {}
    }
    // Muted autoplay; user can unmute. Crossfade still ramps volume when unmuted.
    if (!opts.keepMuteState) vid.muted = true;
    vid.volume = opts.crossfade ? 0 : 1;

    return new Promise(function (resolve) {
      var settled = false;
      function finish(ok) {
        if (settled) return;
        settled = true;
        resolve(!!ok);
      }

      vid.onerror = function () {
        setStatus("Player failed to open this clip — retrying via proxy…", "error");
        finish(false);
      };

      try {
        vid.pause();
      } catch (e0) {}
      while (vid.firstChild) vid.removeChild(vid.firstChild);
      vid.removeAttribute("src");
      vid.src = playSrc;
      vid.load();

      function afterPlay() {
        state.activePlayer = useB ? "b" : "a";
        if (opts.crossfade && other && !other.hidden) {
          rampVolume(other, other.volume || 1, 0, 450).then(function () {
            try {
              other.pause();
            } catch (e1) {}
            other.hidden = true;
            other.style.display = "none";
            other.style.opacity = "1";
          });
          vid.style.opacity = "1";
          if (!vid.muted) rampVolume(vid, 0, 1, 450);
          else vid.volume = 1;
        } else if (other && other !== vid) {
          try {
            other.pause();
          } catch (e2) {}
          other.hidden = true;
          other.style.display = "none";
        }
        // Bind ended on active player only
        vid.onended = function () {
          onVideoEnded();
        };
        if (other) other.onended = null;
        finish(true);
      }

      var playPromise = vid.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.then(afterPlay).catch(function () {
          afterPlay();
        });
      } else {
        afterPlay();
      }
    });
  }

  function produceSegment(seg) {
    if (state.produceAbort) return Promise.resolve(seg);
    ensureSegmentSources(seg);
    if (!seg.sources.length) {
      seg.status = "failed";
      seg.error = "No sources in pool";
      setStatus("Beat " + (seg.index + 1) + " failed: empty film library.", "error");
      return Promise.resolve(seg);
    }

    seg.status = "still";
    seg.error = "";
    renderProgress();
    renderStrip();
    setStatus(
      "Beat " +
        (seg.index + 1) +
        "/" +
        state.project.targetClips +
        " — still from " +
        sourcesLabel(seg) +
        "…",
      "pending"
    );

    return generateStill(seg)
      .then(function (imageUrl) {
        if (state.produceAbort) return seg;
        if (!imageUrl) throw new Error("Empty still URL");
        seg.imageUrl = imageUrl;
        seg.status = "video";
        renderStrip();
        // show still in cinema while video cooks
        showStill(seg);
        setStatus(
          "Beat " +
            (seg.index + 1) +
            "/" +
            state.project.targetClips +
            " — animating 10s loop…",
          "pending"
        );
        return generateVideo(seg).then(function (videoUrl) {
          if (state.produceAbort) return seg;
          if (!videoUrl) throw new Error("Empty video URL");
          seg.videoUrl = videoUrl;
          seg.playUrl = "";
          seg.status = "ready";
          // Always auto-save every generated beat into saved-videos/
          var afterSave = saveVideoToGallery(videoUrl).then(function (saved) {
            if (saved && saved.name) {
              seg.savedName = saved.name;
              if (saved.url) seg.videoUrl = absoluteUrl(saved.url);
            }
            return seg;
          });
          return afterSave.then(function () {
            setStatus(
              "Beat " +
                (seg.index + 1) +
                " ready — preparing playback…",
              "pending"
            );
            return materializePlayback(seg.videoUrl)
              .then(function (playback) {
                seg.playUrl = playback.playUrl;
                return seg;
              })
              .catch(function (matErr) {
                // Still mark ready; play will retry materialize
                seg.playUrl = playUrlFor(seg.videoUrl);
                seg.error = "";
                console.warn("[movie] materialize failed", matErr);
                return seg;
              });
          });
        });
      })
      .then(function (done) {
        if (done && done.status === "ready") {
          state.project.updatedAt = Date.now();
          persistProject();
          renderAll();
          // Always surface the first ready clip so the cinema isn't blank
          if (!state.playing && readyCount() === 1) {
            startPlayback(done.index);
          }
        } else {
          persistProject();
          renderAll();
        }
        return done;
      })
      .catch(function (err) {
        seg.status = "failed";
        seg.error = (err && err.message) || String(err);
        persistProject();
        renderAll();
        setStatus("Beat " + (seg.index + 1) + " failed: " + seg.error, "error");
        return seg;
      });
  }

  function productionLoop() {
    if (!state.producing || state.produceAbort || !state.project) {
      state.producing = false;
      updateActionButtons();
      return Promise.resolve();
    }
    var idx = nextQueuedIndex();
    if (idx < 0) {
      state.producing = false;
      updateActionButtons();
      setStatus(
        "Production complete — " +
          readyCount() +
          "/" +
          state.project.targetClips +
          " clips ready (" +
          formatClock(readyCount() * CLIP_SEC) +
          ").",
        "ok"
      );
      renderAll();
      return Promise.resolve();
    }
    var seg = state.project.segments[idx];
    return produceSegment(seg).then(function () {
      if (!state.producing || state.produceAbort) {
        state.producing = false;
        updateActionButtons();
        setStatus(
          "Production paused — " +
            readyCount() +
            "/" +
            state.project.targetClips +
            " ready.",
          "ok"
        );
        return;
      }
      // brief pause between API jobs
      return delay(600).then(productionLoop);
    });
  }

  function startProduction() {
    if (!state.project) {
      setStatus("Roll a script first.", "error");
      return;
    }
    if (state.producing) return;

    function go() {
      if (!state.pool.length) {
        setStatus(
          "Film library empty — run start_server.bat and hard-refresh so paintings + generated folders load.",
          "error"
        );
        return;
      }
      // refresh empty segments with current multi-source pool
      state.project.segments.forEach(function (seg) {
        if (seg.status === "queued" || seg.status === "failed") {
          if (!seg.sources || !seg.sources.length) ensureSegmentSources(seg);
        }
      });
      state.producing = true;
      state.produceAbort = false;
      updateActionButtons();
      setStatus(
        "Production running — multi-source film library (" +
          state.pool.length +
          " images) · 10s clips…",
        "pending"
      );
      productionLoop();
    }

    if (!state.poolReady || !state.pool.length) {
      setStatus("Loading film library before production…", "pending");
      loadPool().then(go);
      return;
    }
    go();
  }

  function pauseProduction() {
    state.produceAbort = true;
    state.producing = false;
    updateActionButtons();
    setStatus("Pausing after the current beat finishes…", "pending");
  }

  function startPlayback(fromIndex) {
    if (!state.project) return;
    var segs = state.project.segments.filter(function (s) {
      return s.status === "ready" && s.videoUrl;
    });
    if (!segs.length) {
      setStatus("No ready clips yet — start production.", "error");
      return;
    }
    if (fromIndex == null) fromIndex = state.playIndex || 0;
    var readyIdx = 0;
    var i;
    for (i = 0; i < state.project.segments.length; i++) {
      if (state.project.segments[i].status === "ready" && state.project.segments[i].videoUrl) {
        if (i >= fromIndex) {
          readyIdx = i;
          break;
        }
        readyIdx = i;
      }
    }
    state.playIndex = readyIdx;
    state.playing = true;
    playSegmentAt(state.playIndex);
    updateActionButtons();
  }

  function playSegmentAt(index, opts) {
    opts = opts || {};
    var players = getPlayers();
    if (!state.project || (!players.a && !players.b)) return;
    var seg = state.project.segments[index];
    if (!seg || seg.status !== "ready" || !seg.videoUrl) {
      var j;
      for (j = index; j < state.project.segments.length; j++) {
        if (state.project.segments[j].status === "ready" && state.project.segments[j].videoUrl) {
          index = j;
          seg = state.project.segments[j];
          break;
        }
      }
      if (!seg || seg.status !== "ready" || !seg.videoUrl) {
        state.playing = false;
        setStatus("End of ready reel.", "ok");
        updateActionButtons();
        return;
      }
    }
    state.playIndex = index;
    state.playing = true;
    var token = ++state.playToken;
    highlightStrip(index);
    updateProgressLabels();
    updateActionButtons();
    syncCinemaAspect(effectiveAspect(seg));
    setStatus(
      "Loading beat " +
        (index + 1) +
        " · " +
        effectiveAspect(seg) +
        " · " +
        sourcesLabel(seg) +
        "…",
      "pending"
    );

    ensureSegmentPlayable(seg)
      .then(function (playSrc) {
        if (token !== state.playToken) return;
        return mountCinemaVideo(playSrc, seg, {
          crossfade: !!opts.crossfade && state.audioBridge,
        }).then(function (ok) {
          if (token !== state.playToken) return;
          if (!ok) {
            var fallback = playUrlFor(seg.videoUrl);
            return mountCinemaVideo(fallback, seg, { crossfade: false });
          }
          return true;
        });
      })
      .then(function () {
        if (token !== state.playToken) return;
        setStatus(
          "Playing beat " +
            (index + 1) +
            "/" +
            state.project.targetClips +
            " · " +
            effectiveAspect(seg) +
            " · " +
            (seg.act || "") +
            " · " +
            formatClock(index * CLIP_SEC) +
            " — unmute in controls if silent",
          "ok"
        );
        highlightStrip(index);
        updateProgressLabels();
      })
      .catch(function (err) {
        if (token !== state.playToken) return;
        setStatus(
          "Could not play beat " +
            (index + 1) +
            ": " +
            ((err && err.message) || err) +
            " — restart start_server.bat.",
          "error"
        );
        if (seg.imageUrl) showStill(seg);
      });
  }

  function stopPlayback() {
    state.playing = false;
    state.playToken++;
    var vid = $("mv-cinema-video");
    if (vid) {
      try {
        vid.pause();
      } catch (e) {}
    }
    updateActionButtons();
    setStatus("Playback stopped.", "ok");
  }

  function onVideoEnded() {
    if (!state.playing || !state.project) return;
    var next = state.playIndex + 1;
    while (next < state.project.segments.length) {
      var s = state.project.segments[next];
      if (s.status === "ready" && s.videoUrl) {
        // Soft audio/visual handoff into the next 10s beat
        playSegmentAt(next, { crossfade: state.audioBridge });
        return;
      }
      next++;
    }
    if (state.producing) {
      setStatus("Caught up to production — waiting for the next beat…", "pending");
      waitForNextReady(state.playIndex + 1);
    } else {
      state.playing = false;
      setStatus("Feature end (all ready clips played).", "ok");
      updateActionButtons();
    }
  }

  function waitForNextReady(fromIndex) {
    if (!state.playing) return;
    var tries = 0;
    function tick() {
      if (!state.playing || !state.project) return;
      var j;
      for (j = fromIndex; j < state.project.segments.length; j++) {
        var s = state.project.segments[j];
        if (s.status === "ready" && s.videoUrl) {
          playSegmentAt(j);
          return;
        }
      }
      tries++;
      if (tries > 900) {
        state.playing = false;
        setStatus("Timed out waiting for next beat.", "error");
        updateActionButtons();
        return;
      }
      setTimeout(tick, 2000);
    }
    tick();
  }

  function updateProgressLabels() {
    var p = state.project;
    var el = $("mv-progress-text");
    var bar = $("mv-progress-fill");
    var timeEl = $("mv-time-text");
    if (!p) {
      if (el) el.textContent = "No script rolled yet";
      if (bar) bar.style.width = "0%";
      if (timeEl) timeEl.textContent = "0:00 / " + formatClock(state.targetClips * CLIP_SEC);
      return;
    }
    var ready = readyCount();
    var total = p.targetClips;
    var pct = total ? Math.round((ready / total) * 100) : 0;
    if (el) {
      el.textContent =
        ready +
        " / " +
        total +
        " clips ready · " +
        countByStatus("failed") +
        " failed · " +
        (state.producing ? "producing…" : "idle");
    }
    if (bar) bar.style.width = pct + "%";
    if (timeEl) {
      timeEl.textContent =
        formatClock(ready * CLIP_SEC) +
        " ready · feature " +
        formatClock(total * CLIP_SEC) +
        (state.playing ? " · playhead " + formatClock(state.playIndex * CLIP_SEC) : "");
    }
  }

  function renderProgress() {
    updateProgressLabels();
  }

  function highlightStrip(index) {
    document.querySelectorAll(".mv-beat").forEach(function (el) {
      el.classList.toggle("active", parseInt(el.dataset.index, 10) === index);
    });
  }

  function renderStrip() {
    var strip = $("mv-strip");
    if (!strip) return;
    strip.innerHTML = "";
    if (!state.project) {
      strip.innerHTML =
        '<p class="mv-strip-empty">Roll a script to fill the reel (up to 360 beats from the full film library).</p>';
      return;
    }
    state.project.segments.forEach(function (seg) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mv-beat mv-beat-" + seg.status;
      btn.dataset.index = String(seg.index);
      btn.title =
        "Beat " +
        (seg.index + 1) +
        " · " +
        seg.act +
        " · " +
        sourcesLabel(seg) +
        (seg.error ? " — " + seg.error : "");
      if (seg.imageUrl && String(seg.imageUrl).indexOf("data:") !== 0) {
        var thumb = document.createElement("img");
        thumb.src = absoluteUrl(seg.imageUrl);
        thumb.alt = "";
        thumb.loading = "lazy";
        btn.appendChild(thumb);
      } else if (seg.imageUrl && String(seg.imageUrl).indexOf("data:") === 0) {
        var thumb2 = document.createElement("img");
        thumb2.src = seg.imageUrl;
        thumb2.alt = "";
        btn.appendChild(thumb2);
      } else {
        var num = document.createElement("span");
        num.className = "mv-beat-num";
        num.textContent = String(seg.index + 1);
        btn.appendChild(num);
      }
      var badge = document.createElement("span");
      badge.className = "mv-beat-badge";
      badge.textContent =
        seg.status === "ready"
          ? "▶"
          : seg.status === "failed"
            ? "!"
            : seg.status === "still" || seg.status === "video"
              ? "…"
              : "·";
      btn.appendChild(badge);
      btn.addEventListener("click", function () {
        if (seg.status === "ready") {
          state.playing = true;
          playSegmentAt(seg.index);
          updateActionButtons();
        } else if (seg.imageUrl) {
          showStill(seg);
        } else {
          setStatus(
            "Beat " + (seg.index + 1) + " · " + seg.status + " · " + sourcesLabel(seg),
            "ok"
          );
        }
      });
      strip.appendChild(btn);
    });
    highlightStrip(state.playIndex);
  }

  function showStill(seg) {
    hideCinemaLayersExcept("image");
    var img = $("mv-cinema-img");
    if (img && seg && seg.imageUrl) {
      img.src =
        String(seg.imageUrl).indexOf("data:") === 0
          ? seg.imageUrl
          : absoluteUrl(seg.imageUrl);
      img.alt = "Beat " + (seg.index + 1) + " still";
    }
  }

  function updateActionButtons() {
    var hasProject = !!state.project;
    var roll = $("mv-roll");
    var start = $("mv-start");
    var pause = $("mv-pause");
    var play = $("mv-play");
    var stop = $("mv-stop");
    if (roll) roll.disabled = state.producing || state.poolLoading;
    if (start) {
      start.disabled = !hasProject || state.producing || nextQueuedIndex() < 0;
      start.hidden = state.producing;
    }
    if (pause) {
      pause.hidden = !state.producing;
      pause.disabled = !state.producing;
    }
    if (play) play.disabled = !hasProject || readyCount() === 0;
    if (stop) stop.disabled = !state.playing;
  }

  function syncLengthButtons() {
    document.querySelectorAll(".mv-len-btn").forEach(function (btn) {
      var n = parseInt(btn.getAttribute("data-clips"), 10);
      var on = n === state.targetClips;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncToggles() {
    var follow = $("mv-follow");
    var save = $("mv-autosave");
    var autoP = $("mv-auto-produce");
    var audioB = $("mv-audio-bridge");
    var aspect = $("mv-aspect");
    var res = $("mv-res");
    if (follow) follow.checked = state.followAlong;
    if (save) save.checked = state.autoSave;
    if (autoP) autoP.checked = state.autoProduce;
    if (audioB) audioB.checked = state.audioBridge;
    if (aspect) aspect.value = state.aspect;
    if (res) res.value = state.resolution;
  }

  function renderAll() {
    renderProgress();
    renderStrip();
    updateActionButtons();
    syncLengthButtons();
    syncToggles();
    updatePoolHint();
    syncCinemaAspect();
    var meta = $("mv-script-meta");
    if (meta) {
      if (!state.project) {
        meta.textContent =
          "Pick a length, roll the script (bulk-random from the full film library), production starts automatically.";
      } else {
        meta.textContent =
          "Project " +
          state.project.id.slice(0, 8) +
          " · " +
          state.project.targetClips +
          " beats · " +
          (state.project.aspect || state.aspect) +
          " · " +
          (state.project.resolution || state.resolution) +
          " · pool " +
          state.pool.length;
      }
    }
  }

  function bindUi() {
    document.querySelectorAll(".mv-len-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (state.producing) return;
        var n = parseInt(btn.getAttribute("data-clips"), 10);
        if (!n) return;
        state.targetClips = n;
        savePrefs();
        syncLengthButtons();
        setStatus("Target length: " + clipCountLabel(n) + " (" + n + " × 10s clips).", "ok");
      });
    });

    var roll = $("mv-roll");
    if (roll) {
      roll.addEventListener("click", function () {
        if (state.producing) return;
        if (state.project && readyCount() > 0) {
          var ok = window.confirm(
            "Roll a new script? Current progress (" + readyCount() + " ready clips) will be replaced."
          );
          if (!ok) return;
        }
        function doRoll() {
          rollScript(state.targetClips);
        }
        if (!state.poolReady || !state.pool.length) {
          setStatus("Loading film library…", "pending");
          loadPool().then(doRoll);
        } else {
          doRoll();
        }
      });
    }

    var start = $("mv-start");
    if (start) start.addEventListener("click", startProduction);

    var pause = $("mv-pause");
    if (pause) pause.addEventListener("click", pauseProduction);

    var play = $("mv-play");
    if (play) {
      play.addEventListener("click", function () {
        startPlayback(state.playIndex || 0);
      });
    }

    var stop = $("mv-stop");
    if (stop) stop.addEventListener("click", stopPlayback);

    var follow = $("mv-follow");
    if (follow) {
      follow.addEventListener("change", function () {
        state.followAlong = !!follow.checked;
        savePrefs();
      });
    }

    var autosave = $("mv-autosave");
    if (autosave) {
      autosave.addEventListener("change", function () {
        state.autoSave = !!autosave.checked;
        savePrefs();
      });
    }

    var autoP = $("mv-auto-produce");
    if (autoP) {
      autoP.addEventListener("change", function () {
        state.autoProduce = !!autoP.checked;
        savePrefs();
      });
    }

    var audioB = $("mv-audio-bridge");
    if (audioB) {
      audioB.addEventListener("change", function () {
        state.audioBridge = !!audioB.checked;
        savePrefs();
      });
    }

    var aspect = $("mv-aspect");
    if (aspect) {
      aspect.addEventListener("change", function () {
        state.aspect = aspect.value || "16:9";
        if (state.project && !state.producing) {
          state.project.aspect = state.aspect;
          state.project.segments.forEach(function (s) {
            if (s.status === "queued" || s.status === "failed") s.aspect = state.aspect;
          });
        }
        savePrefs();
        persistProject();
        syncCinemaAspect(state.aspect);
        setStatus(
          "Still + video aspect set to " +
            state.aspect +
            ". Regenerate beats so stills match (old stills may be wrong ratio).",
          "ok"
        );
      });
    }

    var res = $("mv-res");
    if (res) {
      res.addEventListener("change", function () {
        state.resolution = res.value === "480p" ? "480p" : "720p";
        if (state.project && !state.producing) state.project.resolution = state.resolution;
        savePrefs();
        persistProject();
      });
    }

    var clear = $("mv-clear");
    if (clear) {
      clear.addEventListener("click", function () {
        if (state.producing) {
          setStatus("Pause production before clearing.", "error");
          return;
        }
        if (!window.confirm("Clear the current movie project?")) return;
        stopPlayback();
        state.project = null;
        try {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem("movie-project-v1");
        } catch (e) {}
        renderAll();
        setStatus("Project cleared.", "ok");
      });
    }

    var reloadPool = $("mv-reload-pool");
    if (reloadPool) {
      reloadPool.addEventListener("click", function () {
        state.poolReady = false;
        state.pool = [];
        loadPool().then(function () {
          renderAll();
        });
      });
    }

    var players = getPlayers();
    if (players.a) players.a.addEventListener("ended", onVideoEnded);
    if (players.b) players.b.addEventListener("ended", onVideoEnded);
  }

  /** Public helpers for Book tab */
  function getProject() {
    return state.project;
  }

  function setProject(project) {
    state.project = project;
    if (project && project.aspect) state.aspect = project.aspect;
    if (project && Array.isArray(project.segments)) {
      project.segments.forEach(migrateSegmentSources);
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
    } catch (e) {}
    if (state.active) renderAll();
  }

  function produceOne(index) {
    if (!state.project || !state.project.segments[index]) {
      return Promise.reject(new Error("No beat at that page."));
    }
    return loadPool().then(function () {
      return produceSegment(state.project.segments[index]).then(function (seg) {
        persistProject();
        renderAll();
        return seg;
      });
    });
  }

  function generateStillOnly(index) {
    if (!state.project || !state.project.segments[index]) {
      return Promise.reject(new Error("No beat at that page."));
    }
    var seg = state.project.segments[index];
    ensureSegmentSources(seg);
    seg.status = "still";
    return loadPool()
      .then(function () {
        return generateStill(seg);
      })
      .then(function (url) {
        seg.imageUrl = url;
        seg.status = seg.videoUrl ? "ready" : "queued";
        persistProject();
        renderAll();
        return seg;
      });
  }

  function generateVideoOnly(index) {
    if (!state.project || !state.project.segments[index]) {
      return Promise.reject(new Error("No beat at that page."));
    }
    var seg = state.project.segments[index];
    if (!seg.imageUrl) {
      return generateStillOnly(index).then(function () {
        return generateVideoOnly(index);
      });
    }
    seg.status = "video";
    return generateVideo(seg).then(function (videoUrl) {
      seg.videoUrl = videoUrl;
      return materializePlayback(videoUrl)
        .then(function (p) {
          seg.playUrl = p.playUrl;
          seg.status = "ready";
          persistProject();
          renderAll();
          return seg;
        })
        .catch(function () {
          seg.playUrl = playUrlFor(videoUrl);
          seg.status = "ready";
          persistProject();
          renderAll();
          return seg;
        });
    });
  }

  function onShow() {
    state.active = true;
    if (!state.poolReady) {
      loadPool().then(function () {
        renderAll();
      });
    } else {
      updatePoolHint();
    }
    renderAll();
  }

  function onHide() {
    state.active = false;
  }

  function boot() {
    if (!$("panel-movie")) return;
    loadPrefs();
    bindUi();
    state.project = loadProject();
    if (state.project && state.project.targetClips) {
      state.targetClips = state.project.targetClips;
      if (state.project.aspect) state.aspect = state.project.aspect;
      if (state.project.resolution) state.resolution = state.project.resolution;
    }
    loadPool().then(function () {
      renderAll();
      if (state.project) {
        setStatus(
          "Restored project — " +
            readyCount() +
            "/" +
            state.project.targetClips +
            " ready · library " +
            state.pool.length +
            " images. Resume production or play.",
          "ok"
        );
      }
    });
    window.dispatchEvent(new Event("movie-ready"));
  }

  window.Movie = {
    onShow: onShow,
    onHide: onHide,
    rollScript: rollScript,
    startProduction: startProduction,
    loadPool: loadPool,
    getProject: getProject,
    setProject: setProject,
    persistProject: persistProject,
    produceOne: produceOne,
    generateStillOnly: generateStillOnly,
    generateVideoOnly: generateVideoOnly,
    effectiveAspect: effectiveAspect,
    composeImaginativeBeat: composeImaginativeBeat,
    reseedScriptsFromSpells: reseedScriptsFromSpells,
    STORAGE_KEY: STORAGE_KEY,
    FULL_HOUR_CLIPS: FULL_HOUR_CLIPS,
    CLIP_SEC: CLIP_SEC,
  };
  window.addEventListener("movie-show", onShow);
  window.addEventListener("movie-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
