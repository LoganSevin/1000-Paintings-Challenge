/**
 * Book — open-spread editor for Movie beats (pages 1–360).
 * Left/right pages = two consecutive 10s scripts; generate still/video per page.
 * Shares the Movie project storage so the reel and the book stay in sync.
 */
(function () {
  "use strict";

  var TOTAL_PAGES = 360;
  var STORAGE_KEY = "movie-project-v2";
  var PREFS_KEY = "book-prefs-v1";
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
  ];

  var state = {
    spreadIndex: 0, // 0 => pages 1–2
    aspect: "16:9",
    busySide: "",
    project: null,
    /** Live mic sessions per side */
    mic: {
      left: null,
      right: null,
    },
    /** pageNum → { blob, url, mime, transcript, clarityMode } — kept in memory (too big for localStorage) */
    voiceByPage: {},
  };

  /**
   * Eventful dialogue beats — stakes, turns, invitations, pushback.
   * Natural speech only. {hook} = specific hinge from their last line.
   * {beat} = a second punch line that moves the moment forward.
   */
  var ART_REPLY_TEMPLATES = [
    "{hook} {beat}",
    "Hold on — {hook} {beat}",
    "Okay, stop. {hook} {beat}",
    "Listen. {hook} {beat}",
    "Wait. {hook} {beat}",
    "Hey. {hook} {beat}",
    "Then we’re not done. {hook} {beat}",
    "Fine — cards on the table. {hook} {beat}",
  ];

  var ART_BEAT_LINES = [
    "What happens if you don’t look away from that?",
    "Say the next true thing. I’m not going first this time.",
    "I’ll meet you there — but only if you mean it.",
    "That’s a door. Are you walking through it or just pointing at it?",
    "I’ve got one answer for you, and it isn’t gentle: stay.",
    "Then change something. Right now. Even a little.",
    "I can hold that with you — or we can do something about it. Which is it?",
    "Don’t vanish after saying that. Stay in the room with me.",
    "If that’s real, prove it. Tell me what you want next.",
    "I believe you. Now what are you going to do with it?",
    "That’s brave. Also dangerous. I’m still here.",
    "Good. That was honest. Keep going — I can take it.",
    "Then we’re in it together. No audience. Just us.",
    "I won’t fix it for you. I will stand in it with you.",
    "Choose: hide, run, or face it with me.",
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, kind) {
    var el = $("bk-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "bk-status" + (kind ? " " + kind : "");
  }

  function setPageStatus(side, msg, kind) {
    var el = $(side === "left" ? "bk-left-status" : "bk-right-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "bk-page-status" + (kind ? " " + kind : "");
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p.aspect) state.aspect = p.aspect;
      if (p.spreadIndex != null) state.spreadIndex = Math.max(0, parseInt(p.spreadIndex, 10) || 0);
    } catch (e) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ aspect: state.aspect, spreadIndex: state.spreadIndex })
      );
    } catch (e) {}
  }

  function maxSpread() {
    return Math.floor((TOTAL_PAGES - 1) / 2);
  }

  function leftPageNum() {
    return state.spreadIndex * 2 + 1;
  }

  function rightPageNum() {
    return Math.min(TOTAL_PAGES, leftPageNum() + 1);
  }

  function emptyBeat(index, total) {
    total = total || TOTAL_PAGES;
    // Prefer Movie's spell-aware imaginative seed (titles, descriptions, styles from the pool)
    if (window.Movie && typeof window.Movie.composeImaginativeBeat === "function") {
      try {
        var rich = window.Movie.composeImaginativeBeat(index, total, null);
        if (rich) {
          rich.aspect = state.aspect || rich.aspect || "16:9";
          return rich;
        }
      } catch (e) {}
    }
    var act = ACT_TITLES[Math.floor((index / total) * ACT_TITLES.length)] || "Wander";
    return {
      index: index,
      page: index + 1,
      act: act,
      sources: [],
      spells: [],
      script:
        "SCENE — Page " +
        (index + 1) +
        " · " +
        act +
        " — load the film library then Seed again so spells write the stage picture.",
      dialogue: "",
      conversation: [],
      motion: "Soft living motion inside the frame; fixed camera.",
      audioBridge:
        "Soft continuous atmosphere that can crossfade into the next 10 seconds — no hard silence.",
      aspect: state.aspect || "16:9",
      imageUrl: "",
      videoUrl: "",
      playUrl: "",
      savedName: "",
      status: "queued",
      error: "",
    };
  }

  function ensureProject(len) {
    len = len || TOTAL_PAGES;
    if (window.Movie && window.Movie.getProject) {
      var mp = window.Movie.getProject();
      if (mp && Array.isArray(mp.segments) && mp.segments.length) {
        state.project = mp;
        while (state.project.segments.length < len) {
          state.project.segments.push(
            emptyBeat(state.project.segments.length, len)
          );
        }
        if (state.project.aspect) state.aspect = state.project.aspect;
        return state.project;
      }
    }
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && Array.isArray(p.segments) && p.segments.length) {
          state.project = p;
          while (state.project.segments.length < len) {
            state.project.segments.push(
              emptyBeat(state.project.segments.length, len)
            );
          }
          if (state.project.aspect) state.aspect = state.project.aspect;
          return state.project;
        }
      }
    } catch (e) {}
    seedPages(len);
    return state.project;
  }

  function seedPages(len) {
    len = len || TOTAL_PAGES;
    setStatus("Loading spells and writing imaginative scripts…", "pending");

    function build() {
      var segments = [];
      var i;
      for (i = 0; i < len; i++) segments.push(emptyBeat(i, len));
      state.project = {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : "book-" + Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        targetClips: len,
        clipSec: 10,
        aspect: state.aspect || "16:9",
        resolution: "720p",
        segments: segments,
      };
      persist();
      var sample = segments[0] && segments[0].script ? segments[0].script.slice(0, 90) : "";
      setStatus(
        "Seeded " +
          len +
          " pages from spell DNA (" +
          len * 10 +
          "s). e.g. “" +
          sample +
          "…”",
        "ok"
      );
      return state.project;
    }

    if (window.Movie && typeof window.Movie.loadPool === "function") {
      return window.Movie.loadPool()
        .then(function () {
          return build();
        })
        .catch(function (err) {
          setStatus(
            "Spell pool weak — seeded with fallbacks. " + ((err && err.message) || ""),
            "error"
          );
          return build();
        });
    }
    return Promise.resolve(build());
  }

  function reseedCurrentFromSpells() {
    flushUiToProject();
    if (window.Movie && typeof window.Movie.reseedScriptsFromSpells === "function") {
      if (window.Movie.setProject && state.project) window.Movie.setProject(state.project);
      setStatus("Reseeding scripts from spells…", "pending");
      return window.Movie.reseedScriptsFromSpells({ keepMedia: true })
        .then(function (proj) {
          state.project = proj || window.Movie.getProject();
          renderSpread();
          setStatus("Scripts rewritten from spell titles, descriptions, and styles.", "ok");
        })
        .catch(function (err) {
          setStatus((err && err.message) || "Reseed failed.", "error");
        });
    }
    return seedPages(TOTAL_PAGES).then(function () {
      state.spreadIndex = 0;
      renderSpread();
    });
  }

  function persist() {
    if (!state.project) return;
    state.project.updatedAt = Date.now();
    state.project.aspect = state.aspect || state.project.aspect;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
    } catch (e) {}
    if (window.Movie && window.Movie.setProject) {
      try {
        window.Movie.setProject(state.project);
      } catch (e2) {}
    }
  }

  function beatAtPage(pageNum) {
    ensureProject();
    var idx = pageNum - 1;
    if (!state.project.segments[idx]) {
      state.project.segments[idx] = emptyBeat(idx);
    }
    var b = state.project.segments[idx];
    b.index = idx;
    b.page = pageNum;
    if (!b.aspect) b.aspect = state.aspect;
    return b;
  }

  function readSideFromUi(side) {
    var pageNum = side === "left" ? leftPageNum() : rightPageNum();
    if (pageNum > TOTAL_PAGES) return null;
    var b = beatAtPage(pageNum);
    var scriptEl = $(side === "left" ? "bk-left-script" : "bk-right-script");
    var dialogueEl = $(side === "left" ? "bk-left-dialogue" : "bk-right-dialogue");
    var motionEl = $(side === "left" ? "bk-left-motion" : "bk-right-motion");
    var audioEl = $(side === "left" ? "bk-left-audio" : "bk-right-audio");
    if (scriptEl) b.script = scriptEl.value;
    if (dialogueEl) b.dialogue = dialogueEl.value;
    if (motionEl) b.motion = motionEl.value;
    if (audioEl) b.audioBridge = audioEl.value;
    b.aspect = state.aspect;
    return b;
  }

  function writeSideToUi(side, beat) {
    var numEl = $(side === "left" ? "bk-left-num" : "bk-right-num");
    var actEl = $(side === "left" ? "bk-left-act" : "bk-right-act");
    var scriptEl = $(side === "left" ? "bk-left-script" : "bk-right-script");
    var dialogueEl = $(side === "left" ? "bk-left-dialogue" : "bk-right-dialogue");
    var motionEl = $(side === "left" ? "bk-left-motion" : "bk-right-motion");
    var audioEl = $(side === "left" ? "bk-left-audio" : "bk-right-audio");
    var img = $(side === "left" ? "bk-left-img" : "bk-right-img");
    var vid = $(side === "left" ? "bk-left-vid" : "bk-right-vid");
    var empty = $(side === "left" ? "bk-left-empty" : "bk-right-empty");
    var page = side === "left" ? leftPageNum() : rightPageNum();

    if (page > TOTAL_PAGES) {
      if (numEl) numEl.textContent = "—";
      return;
    }

    if (numEl) numEl.textContent = "Page " + page;
    if (actEl) actEl.textContent = beat ? beat.act || "" : "";
    if (scriptEl) scriptEl.value = beat ? beat.script || "" : "";
    if (dialogueEl) dialogueEl.value = beat ? beat.dialogue || "" : "";
    if (motionEl) motionEl.value = beat ? beat.motion || "" : "";
    if (audioEl) audioEl.value = beat ? beat.audioBridge || "" : "";

    var ar = (beat && beat.aspect) || state.aspect || "16:9";
    var preview = side === "left" ? $("bk-page-left") : $("bk-page-right");
    if (preview) {
      var parts = String(ar).split(":");
      var aw = parseFloat(parts[0]) || 16;
      var ah = parseFloat(parts[1]) || 9;
      var box = preview.querySelector(".bk-page-preview");
      if (box) box.style.setProperty("--bk-ar", aw + " / " + ah);
    }

    if (vid) {
      vid.hidden = true;
      vid.removeAttribute("src");
    }
    if (img) img.hidden = true;
    if (empty) empty.hidden = false;

    if (beat && beat.videoUrl && vid) {
      if (empty) empty.hidden = true;
      vid.hidden = false;
      var src =
        beat.playUrl && String(beat.playUrl).indexOf("blob:") === 0
          ? beat.playUrl
          : beat.videoUrl;
      try {
        vid.src =
          src.indexOf("http") === 0 || src.indexOf("/") === 0 || src.indexOf("blob:") === 0
            ? src
            : src;
      } catch (e) {}
      vid.load();
    } else if (beat && beat.imageUrl && img) {
      if (empty) empty.hidden = true;
      img.hidden = false;
      img.src = beat.imageUrl;
    }

    renderConversation(side, beat);
    syncMicButton(side);
    syncVoiceUi(side, beat);
  }

  function syncVoiceUi(side, beat) {
    var pageNum = side === "left" ? leftPageNum() : rightPageNum();
    var audio = $(side === "left" ? "bk-left-voice" : "bk-right-voice");
    var clarity = $(side === "left" ? "bk-left-clarity" : "bk-right-clarity");
    var pack = state.voiceByPage[pageNum];
    if (audio) {
      if (pack && pack.url) {
        audio.hidden = false;
        if (audio.getAttribute("src") !== pack.url) {
          audio.src = pack.url;
        }
      } else {
        audio.hidden = true;
        audio.removeAttribute("src");
      }
    }
    if (clarity) {
      clarity.hidden = !(pack && pack.transcript);
    }
  }

  function pickOne(arr) {
    if (!arr || !arr.length) return "";
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function clip(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    if (s.length <= n) return s;
    return s.slice(0, n - 1).trim() + "…";
  }

  function spellHooksFromBeat(beat) {
    var titles = ["the unfinished sky", "the wet door", "the third witness"];
    var hooks = ["a color that refuses names", "weather under glass", "a pulse in the glaze"];
    var styles = ["painterly", "uncanny", "devotional"];
    var act = (beat && beat.act) || "Wander";
    var script = (beat && beat.script) || "";
    var dialogue = (beat && beat.dialogue) || "";
    var titleMatches = script.match(/[“"]([^”"]{2,60})[”"]/g) || [];
    titleMatches = titleMatches.map(function (t) {
      return t.replace(/^[“"]|[”"]$/g, "");
    });
    if (titleMatches[0]) titles[0] = titleMatches[0];
    if (titleMatches[1]) titles[1] = titleMatches[1];
    if (titleMatches[2]) titles[2] = titleMatches[2];
    var dna = script.match(/Spell DNA:([^\n]+)/i);
    if (dna) {
      var parts = dna[1].split("·").map(function (p) {
        return p.trim();
      });
      parts.forEach(function (p, i) {
        var m = p.match(/[“"]([^”"]+)[”"]/);
        if (m && i < 3) titles[i] = m[1];
      });
    }
    // Pull quoted lines from dialogue as character voice flavor
    var spoken = dialogue.match(/^[A-Z][A-Z' \-]{1,40}\n(.+)$/m);
    if (spoken) hooks[0] = clip(spoken[1], 90);
    return {
      title0: titles[0],
      title1: titles[1],
      title2: titles[2],
      hook0: hooks[0],
      hook1: hooks[1],
      hook2: hooks[2],
      style0: styles[0],
      act: act,
    };
  }

  function fillTpl(tpl, map) {
    return String(tpl || "").replace(/\{([a-z0-9]+)\}/gi, function (_, k) {
      return map[k] != null ? map[k] : "";
    });
  }

  function extractArtSpeaker(beat) {
    var d = (beat && beat.dialogue) || "";
    var m = d.match(/^([A-Z][A-Z' \-]{1,40})\n/m);
    if (m) return m[1].trim();
    return "THE PAGE";
  }

  /** Clean full last line for generation / intercom (exact words kept only for YOU + stasis content). */
  function lastLineClean(userText) {
    var t = String(userText || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || /^\[Voice /i.test(t)) return "";
    return clip(t, 220);
  }

  function toneFromSpeech(userText) {
    var t = String(userText || "").toLowerCase();
    if (/!{1,}|\b(wow|yes|love|beautiful|amazing)\b/.test(t)) return "warm";
    if (/\?/.test(t)) return "curious";
    if (/\b(no|don't|stop|hate|angry|mad)\b/.test(t)) return "firm";
    if (/\b(please|sorry|miss|wish|hope)\b/.test(t)) return "gentle";
    if (/\b(ha|haha|lol|funny)\b/.test(t)) return "light";
    if (/\b(sad|hurt|cry|lost|alone)\b/.test(t)) return "soft";
    return "steady";
  }

  /**
   * Eventful hinge from their line — stakes and turn, not bland validation.
   * Never returns their full sentence.
   */
  function conversationalHook(userText) {
    var t = lastLineClean(userText);
    if (!t) return "Something just shifted between us.";
    var lower = t.toLowerCase();

    if (/\?\s*$/.test(t) || /^(what|why|how|who|when|where|do|does|did|is|are|can|could|would|will)\b/i.test(t)) {
      return pickOne([
        "That question has teeth.",
        "You’re asking for more than small talk.",
        "I won’t dodge the question.",
        "That’s the real question, isn’t it?",
      ]);
    }
    if (/\b(love|like|miss|need|want|desire)\b/i.test(lower)) {
      return pickOne([
        "Wanting something that much changes the room.",
        "There’s heat in that — I felt it.",
        "That’s not casual. Don’t pretend it is.",
        "Desire just walked in with you.",
      ]);
    }
    if (/\b(scared|afraid|worry|anxious|nervous|fear)\b/i.test(lower)) {
      return pickOne([
        "Fear just named itself out loud.",
        "You’re scared — and you still spoke. That’s a move.",
        "The fear is real. So is you standing here.",
        "That flinch means something’s at stake.",
      ]);
    }
    if (/\b(sad|hurt|lonely|alone|lost|cry|grief)\b/i.test(lower)) {
      return pickOne([
        "That hurt just took the air out of the room.",
        "You’re carrying something heavy — I won’t pretend otherwise.",
        "Loss is standing between us. I see it.",
        "That sadness isn’t small. Neither are you.",
      ]);
    }
    if (/\b(angry|mad|hate|frustrated|furious|pissed)\b/i.test(lower)) {
      return pickOne([
        "There’s fire in that. Good — don’t swallow it.",
        "Anger means a boundary got crossed.",
        "I can take the heat. Keep going.",
        "That rage has a story. I’m listening.",
      ]);
    }
    if (/\b(leave|go|quit|done|over|end)\b/i.test(lower)) {
      return pickOne([
        "Leaving is a choice — so is staying.",
        "If you walk, walk knowing I heard you.",
        "Endings deserve honesty. So does this.",
        "Don’t vanish mid-sentence.",
      ]);
    }
    if (/\b(secret|truth|lie|honest|real|fake)\b/i.test(lower)) {
      return pickOne([
        "Truth just entered the chat.",
        "If we’re doing honesty, we do it all the way.",
        "Secrets hate the light. You brought one anyway.",
        "Real talk — finally.",
      ]);
    }
    if (/\b(help|save|please|need you)\b/i.test(lower)) {
      return pickOne([
        "You asked. I’m not pretending I didn’t hear.",
        "Help is a brave word. I won’t mock it.",
        "I’m here — not as a hero, as company.",
        "You reached. I reach back.",
      ]);
    }
    if (/\b(hello|hi|hey|yo)\b/i.test(lower)) {
      return pickOne([
        "Hey. Something’s about to happen between us.",
        "Hi — don’t waste this on small talk if you don’t want to.",
        "You’re here. I’m here. That’s already a scene.",
      ]);
    }
    if (/\b(love you|i love)\b/i.test(lower)) {
      return pickOne([
        "That lands hard. I’m not laughing it off.",
        "Love is a plot twist. I’m still standing.",
        "You said the dangerous thing. I’m still here.",
      ]);
    }
    return pickOne([
      "Something just cracked open.",
      "That wasn’t nothing.",
      "You moved the story forward.",
      "I felt that hit.",
      "We’re not in small talk anymore.",
      "The moment just got real.",
    ]);
  }

  function stripVisualSpeak(text) {
    return String(text || "")
      .replace(/\b(frame|canvas|painting|pigment|glaze|brush|stasis|spell|palette|composition|still life|tableau|oil|acrylic)\b/gi, "")
      .replace(/\b(I am (the )?(art|page|image|picture))\b/gi, "I")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.!?])/g, "$1")
      .trim();
  }

  function exchangeTurnCount(beat) {
    var log = (beat && beat.conversation) || [];
    var n = 0;
    log.forEach(function (t) {
      if (t && t.role === "you") n++;
    });
    return n + 1; // including the line about to be added
  }

  function escalateBeatLine(turn) {
    var pool = ART_BEAT_LINES.slice();
    if (turn >= 4) {
      pool = pool.concat([
        "This is the point of no return — choose.",
        "If you leave now, the story ends. If you stay, it costs something.",
        "I’m not soft on this turn. What do you want from me?",
        "Third act energy: truth or silence. Pick.",
      ]);
    } else if (turn >= 2) {
      pool = pool.concat([
        "We’re past the introduction. Raise the stakes with me.",
        "That was chapter one. What’s chapter two?",
        "Don’t reset — build. What changes because you said that?",
      ]);
    }
    return pickOne(pool) || "Stay with me.";
  }

  function composeArtReply(userText, beat) {
    var exact = lastLineClean(userText);
    var turn = exchangeTurnCount(beat);
    var hook = conversationalHook(userText);
    var beatLine = escalateBeatLine(turn);
    if (beat && beat.lastArtReply && beat.lastArtReply.indexOf(beatLine.slice(0, 18)) >= 0) {
      beatLine = escalateBeatLine(turn + 1);
    }
    // Continuity callback — reference prior exchange without monologuing about art
    var prior = "";
    if (turn > 1 && beat && beat.lastArtReply) {
      prior = pickOne([
        "Building on what I just told you — ",
        "Same conversation, next beat — ",
        "We’re not starting over — ",
        "Following from a second ago — ",
      ]);
    }
    var body = prior + fillTpl(pickOne(ART_REPLY_TEMPLATES), {
      hook: hook,
      beat: beatLine,
    });
    body = stripVisualSpeak(body);
    if (!body || body.length < 8) {
      body = "I’m with you. " + beatLine;
    }
    if (exact && exact.length > 10 && body.toLowerCase().indexOf(exact.toLowerCase()) >= 0) {
      body = prior + hook + " " + beatLine + " I’m answering you — not echoing you.";
    }
    body = body.replace(/\s+/g, " ").trim();
    return {
      speaker: "THE ART",
      text: body,
      scriptBlock: "THE ART\n" + body,
      lastLine: exact,
      tone: toneFromSpeech(userText),
      eventBeat: beatLine,
      exchangeTurn: turn,
    };
  }

  /**
   * Grab the last frame of the prior video (or fall back to current still) as data URL.
   * Next generation continues from this frame — not a cold intro.
   */
  function captureContinuityFrame(beat) {
    var videoSrc = beat && (beat.playUrl || beat.videoUrl);
    var stillSrc = beat && beat.imageUrl;

    function fromImageUrl(url) {
      if (!url) return Promise.resolve("");
      return new Promise(function (resolve) {
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () {
          try {
            var c = document.createElement("canvas");
            c.width = img.naturalWidth || img.width || 720;
            c.height = img.naturalHeight || img.height || 1280;
            var ctx = c.getContext("2d");
            if (!ctx) return resolve("");
            ctx.drawImage(img, 0, 0);
            resolve(c.toDataURL("image/jpeg", 0.9));
          } catch (e) {
            resolve("");
          }
        };
        img.onerror = function () {
          resolve("");
        };
        var src = String(url);
        if (src.indexOf("data:") === 0 || src.indexOf("blob:") === 0) img.src = src;
        else {
          try {
            img.src = new URL(src, window.location.href).href;
          } catch (e2) {
            img.src = src;
          }
        }
      });
    }

    if (videoSrc && String(videoSrc).indexOf("data:") !== 0) {
      return new Promise(function (resolve) {
        var v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        var done = false;
        function finish(dataUrl) {
          if (done) return;
          done = true;
          try {
            v.removeAttribute("src");
            v.load();
          } catch (eR) {}
          if (dataUrl) resolve(dataUrl);
          else fromImageUrl(stillSrc).then(resolve);
        }
        v.onloadedmetadata = function () {
          try {
            var t = v.duration;
            if (!isFinite(t) || t <= 0) {
              finish("");
              return;
            }
            v.currentTime = Math.max(0, t - 0.12);
          } catch (eM) {
            finish("");
          }
        };
        v.onseeked = function () {
          try {
            var w = v.videoWidth || 720;
            var h = v.videoHeight || 1280;
            var c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            var ctx = c.getContext("2d");
            if (!ctx || !w) return finish("");
            ctx.drawImage(v, 0, 0, w, h);
            finish(c.toDataURL("image/jpeg", 0.9));
          } catch (eS) {
            finish("");
          }
        };
        v.onerror = function () {
          finish("");
        };
        setTimeout(function () {
          finish("");
        }, 8000);
        try {
          if (String(videoSrc).indexOf("blob:") === 0) v.src = videoSrc;
          else v.crossOrigin = "anonymous";
          v.src =
            String(videoSrc).indexOf("http") === 0 ||
            String(videoSrc).indexOf("/") === 0 ||
            String(videoSrc).indexOf("blob:") === 0
              ? videoSrc
              : videoSrc;
          v.load();
        } catch (eL) {
          finish("");
        }
      });
    }
    return fromImageUrl(stillSrc);
  }

  function ensureConversation(beat) {
    if (!beat.conversation || !Array.isArray(beat.conversation)) beat.conversation = [];
    return beat.conversation;
  }

  function renderConversation(side, beat) {
    var el = $(side === "left" ? "bk-left-conversation" : "bk-right-conversation");
    if (!el) return;
    el.innerHTML = "";
    var log = (beat && beat.conversation) || [];
    log.forEach(function (turn) {
      var div = document.createElement("div");
      var role = turn.role || "art";
      div.className = "bk-chat-line " + role;
      var who = document.createElement("span");
      who.className = "bk-chat-who";
      if (role === "you") who.textContent = "You";
      else who.textContent = turn.speaker || "The art";
      div.appendChild(who);
      div.appendChild(document.createTextNode(turn.text || ""));
      el.appendChild(div);
    });
    el.scrollTop = el.scrollHeight;
  }

  function pickPerformVoice() {
    if (!window.speechSynthesis) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    var prefer = [
      /microsoft.*(zira|jenny|aria|sara)/i,
      /google.*(us|uk).*female/i,
      /samantha/i,
      /female/i,
      /english/i,
      /\ben-us\b/i,
    ];
    var i;
    var j;
    for (i = 0; i < prefer.length; i++) {
      for (j = 0; j < voices.length; j++) {
        var label = (voices[j].name || "") + " " + (voices[j].lang || "");
        if (prefer[i].test(label)) return voices[j];
      }
    }
    return voices[0] || null;
  }

  /**
   * Speak the art’s natural reply only (never the visitor’s line, never a visual brief).
   */
  function performArtReply(text) {
    text = String(text || "").trim();
    // Guard: if a visual brief leaked in, don’t speak it
    if (/VISUAL STASIS|Fixed camera|Spell DNA|on-screen text/i.test(text)) {
      text = "I hear you. I’m right here with you.";
    }
    if (!text || !window.speechSynthesis) return Promise.resolve(false);
    if (/^\[Voice /i.test(text)) return Promise.resolve(false);

    return new Promise(function (resolve) {
      try {
        window.speechSynthesis.cancel();
      } catch (eC) {}

      function run() {
        var u = new SpeechSynthesisUtterance(text);
        // Natural conversation pacing
        u.rate = 1.0;
        u.pitch = 1.0;
        u.volume = 1;
        var voice = pickPerformVoice();
        if (voice) u.voice = voice;
        u.lang = (voice && voice.lang) || navigator.language || "en-US";
        var settled = false;
        function done(ok) {
          if (settled) return;
          settled = true;
          resolve(!!ok);
        }
        u.onend = function () {
          done(true);
        };
        u.onerror = function () {
          done(false);
        };
        setTimeout(function () {
          done(true);
        }, Math.min(60000, 2500 + text.length * 70));
        try {
          window.speechSynthesis.speak(u);
        } catch (eS) {
          done(false);
        }
      }

      var voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) {
        var once = function () {
          window.speechSynthesis.onvoiceschanged = null;
          run();
        };
        window.speechSynthesis.onvoiceschanged = once;
        setTimeout(once, 400);
      } else {
        run();
      }
    });
  }

  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.getVoices();
    } catch (eW) {}
  }

  /** Strip live-talk / caption residue so generation does not keep old material. */
  function stripLiveTalkFromText(text) {
    text = String(text || "");
    if (!text) return "";
    // Remove LIVE CHAT caption blocks and — Live talk — / Clarity sections
    text = text.replace(/\n*LIVE CHAT[\s\S]*?(?=\n\n[A-Z]|\n*$)/gi, "");
    text = text.replace(/\n*—\s*Live talk\s*—[\s\S]*?(?=\n*—|\n*$)/gi, "");
    text = text.replace(/\n*—\s*Clarity re-take\s*—[\s\S]*?(?=\n*—|\n*$)/gi, "");
    text = text.replace(
      /\n*VISITOR SPOKE TO THE PAGE[\s\S]*?(?=\n\n[A-Z]|\n*$)/gi,
      ""
    );
    text = text.replace(
      /\n*Fixed camera\. (Subtle life|Art-style response)[\s\S]*?(?=\n|$)/gi,
      ""
    );
    text = text.replace(
      /\n*Atmospheric bed only \(no real visitor mic track\)[\s\S]*?(?=\n|$)/gi,
      ""
    );
    text = text.replace(
      /\n*Leave room under the bed for the visitor's recorded voice[\s\S]*?(?=\n|$)/gi,
      ""
    );
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  function clearPageChat(side) {
    flushUiToProject();
    var pageNum = side === "left" ? leftPageNum() : rightPageNum();
    if (pageNum > TOTAL_PAGES) return;
    var beat = beatAtPage(pageNum);
    beat.conversation = [];
    beat.lastHeard = "";
    beat.lastArtReply = "";
    beat.usedCaptionsOnly = false;
    beat.dialogue = stripLiveTalkFromText(beat.dialogue);
    beat.script = stripLiveTalkFromText(beat.script);
    beat.motion = stripLiveTalkFromText(beat.motion);
    beat.audioBridge = stripLiveTalkFromText(beat.audioBridge);
    // Drop voice preview for this page
    var pack = state.voiceByPage[pageNum];
    if (pack && pack.url) {
      try {
        URL.revokeObjectURL(pack.url);
      } catch (e) {}
    }
    delete state.voiceByPage[pageNum];
    persist();
    writeSideToUi(side, beat);
    setPageStatus(side, "Chat cleared — next talk starts fresh.", "ok");
    setStatus("Page " + pageNum + ": chat cleared.", "ok");
  }

  function clearPageMedia(side) {
    flushUiToProject();
    var pageNum = side === "left" ? leftPageNum() : rightPageNum();
    if (pageNum > TOTAL_PAGES) return;
    var beat = beatAtPage(pageNum);
    beat.imageUrl = "";
    beat.videoUrl = "";
    beat.playUrl = "";
    beat.savedName = "";
    beat.savedAsMp4 = false;
    beat.voiceMixed = false;
    beat.hasVisitorVoice = false;
    beat.voiceMixFailed = false;
    beat.saveError = "";
    beat.continuityRef = "";
    beat.continueScene = false;
    beat.exchangeTurn = 0;
    if (beat.status === "ready" || beat.status === "still" || beat.status === "video") {
      beat.status = "queued";
    }
    beat.error = "";
    persist();
    writeSideToUi(side, beat);
    setPageStatus(side, "Still and video cleared (next talk starts a new intro).", "ok");
    setStatus("Page " + pageNum + ": media cleared.", "ok");
  }

  function clearPageChatAndMedia(side) {
    clearPageChat(side);
    clearPageMedia(side);
    setPageStatus(side, "Chat and image cleared — clean slate on this page.", "ok");
    setStatus(
      "Page " +
        (side === "left" ? leftPageNum() : rightPageNum()) +
        ": chat & image cleared.",
      "ok"
    );
  }

  function syncMicButton(side) {
    var btn = $(side === "left" ? "bk-left-mic" : "bk-right-mic");
    if (!btn) return;
    var m = state.mic[side];
    var label = btn.querySelector(".bk-mic-label");
    btn.classList.remove("recording", "thinking");
    btn.setAttribute("aria-pressed", "false");
    if (m && m.thinking) {
      btn.classList.add("thinking");
      if (label) label.textContent = "Answering · generating…";
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    if (m && m.recording) {
      btn.classList.add("recording");
      btn.setAttribute("aria-pressed", "true");
      if (label) {
        label.textContent = m.clarityMode
          ? "Stop · clearer captions"
          : "Stop · reply + still + video";
      }
    } else if (label) {
      label.textContent = "Talk to page";
    }
  }

  function getSpeechRecognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function stopMicTracks(side) {
    var m = state.mic[side];
    if (!m) return;
    if (m.recognition) {
      try {
        m.recognition.onresult = null;
        m.recognition.onerror = null;
        m.recognition.onend = null;
        m.recognition.stop();
      } catch (e) {}
      m.recognition = null;
    }
    if (m.rec && m.rec.state !== "inactive") {
      try {
        m.rec.stop();
      } catch (e2) {}
    }
    m.rec = null;
    if (m.stream) {
      m.stream.getTracks().forEach(function (t) {
        try {
          t.stop();
        } catch (e3) {}
      });
    }
    m.stream = null;
    m.recording = false;
  }

  function sessionSpeechText(m) {
    if (!m) return "";
    return [m.committed, m.finals, m.interim]
      .filter(function (s) {
        return s && String(s).trim();
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function rebuildSpeechFromEvent(ev) {
    // Always rebuild from the full result list for THIS recognition instance.
    // Do not append blindly from resultIndex — that duplicates or sticks on old phrases.
    var finals = [];
    var interim = "";
    var i;
    for (i = 0; i < ev.results.length; i++) {
      var r = ev.results[i];
      var piece = (r[0] && r[0].transcript) || "";
      if (r.isFinal) finals.push(piece);
      else interim += piece;
    }
    return {
      finals: finals.join(" ").replace(/\s+/g, " ").trim(),
      interim: interim.replace(/\s+/g, " ").trim(),
    };
  }

  function startTalking(side) {
    var other = side === "left" ? "right" : "left";
    if (state.mic[other] && (state.mic[other].recording || state.mic[other].thinking)) {
      setPageStatus(other, "Finish the other page first.", "error");
      return;
    }
    // Kill any leftover session so old transcripts cannot bleed in
    if (state.mic[side]) {
      stopMicTracks(side);
      state.mic[side] = null;
    }
    flushUiToProject();
    var pageNum = side === "left" ? leftPageNum() : rightPageNum();
    if (pageNum > TOTAL_PAGES) return;

    var SR = getSpeechRecognition();
    var sessionId =
      Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
    var micState = {
      sessionId: sessionId,
      recording: true,
      thinking: false,
      stream: null,
      rec: null,
      chunks: [],
      recognition: null,
      /** Finals from completed recognition restarts within this press */
      committed: "",
      /** Finals from the current SpeechRecognition instance only */
      finals: "",
      interim: "",
      clarityMode: false,
      clarityTranscript: "",
    };
    state.mic[side] = micState;
    syncMicButton(side);
    setPageStatus(side, "Listening… speak now, then press Stop.", "pending");
    setStatus("Page " + pageNum + " is listening (new take).", "pending");

    // Prefer live speech recognition (Chrome/Edge)
    if (SR) {
      try {
        var recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = navigator.language || "en-US";
        recognition.onresult = function (ev) {
          if (!state.mic[side] || state.mic[side].sessionId !== sessionId) return;
          if (!state.mic[side].recording) return;
          var rebuilt = rebuildSpeechFromEvent(ev);
          micState.finals = rebuilt.finals;
          micState.interim = rebuilt.interim;
          var live = sessionSpeechText(micState);
          if (live) {
            setPageStatus(side, "Hearing: “" + clip(live, 100) + "”", "pending");
          }
        };
        recognition.onerror = function (ev) {
          if (!state.mic[side] || state.mic[side].sessionId !== sessionId) return;
          if (ev.error === "no-speech" || ev.error === "aborted") return;
          setPageStatus(side, "Mic recognition: " + (ev.error || "error"), "error");
        };
        recognition.onend = function () {
          if (!state.mic[side] || state.mic[side].sessionId !== sessionId) return;
          // Browser may auto-stop: stash this instance's finals, then start a clean instance
          if (micState.recording && micState.recognition === recognition) {
            if (micState.finals) {
              micState.committed = [micState.committed, micState.finals]
                .filter(Boolean)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
            }
            // Keep interim only if we have nothing committed yet (mid-word)
            if (!micState.committed && micState.interim) {
              micState.committed = micState.interim;
            }
            micState.finals = "";
            micState.interim = "";
            try {
              recognition.start();
            } catch (eRestart) {
              // Some browsers need a new instance after onend
              try {
                var again = new SR();
                again.continuous = true;
                again.interimResults = true;
                again.maxAlternatives = 1;
                again.lang = recognition.lang;
                again.onresult = recognition.onresult;
                again.onerror = recognition.onerror;
                again.onend = recognition.onend;
                micState.recognition = again;
                again.start();
              } catch (e2) {}
            }
          }
        };
        micState.recognition = recognition;
        recognition.start();
      } catch (eSR) {
        setPageStatus(
          side,
          "Speech recognition failed to start. Use Chrome/Edge and allow the microphone.",
          "error"
        );
      }
    } else {
      setPageStatus(
        side,
        "No live captions in this browser — audio will still record for the video mix. Chrome/Edge recommended.",
        "pending"
      );
    }

    // Always capture audio bytes so we can mix voice into the generated video
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(function (stream) {
          if (!state.mic[side] || !state.mic[side].recording) {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
            return;
          }
          micState.stream = stream;
          try {
            var mime = "";
            if (typeof MediaRecorder !== "undefined") {
              if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))
                mime = "audio/webm;codecs=opus";
              else if (MediaRecorder.isTypeSupported("audio/webm")) mime = "audio/webm";
              else if (MediaRecorder.isTypeSupported("audio/mp4")) mime = "audio/mp4";
            }
            var rec = mime
              ? new MediaRecorder(stream, { mimeType: mime })
              : new MediaRecorder(stream);
            micState.rec = rec;
            micState.chunks = [];
            rec.ondataavailable = function (ev) {
              if (ev.data && ev.data.size) micState.chunks.push(ev.data);
            };
            rec.start(200);
          } catch (eRec) {
            setPageStatus(
              side,
              "Mic open but recorder failed — captions may work without voice mix.",
              "pending"
            );
          }
        })
        .catch(function (err) {
          stopMicTracks(side);
          state.mic[side] = null;
          syncMicButton(side);
          setPageStatus(
            side,
            "Microphone blocked: " +
              ((err && err.message) || err) +
              " — allow mic access for voice capture.",
            "error"
          );
        });
    } else {
      setPageStatus(side, "No media devices API — cannot record voice.", "error");
    }
  }

  function stopRecorderPromise(m) {
    return new Promise(function (resolve) {
      if (!m || !m.rec) {
        resolve(
          m && m.chunks && m.chunks.length
            ? new Blob(m.chunks, { type: "audio/webm" })
            : null
        );
        return;
      }
      if (m.rec.state === "inactive") {
        resolve(
          m.chunks && m.chunks.length
            ? new Blob(m.chunks, { type: m.rec.mimeType || "audio/webm" })
            : null
        );
        return;
      }
      m.rec.onstop = function () {
        resolve(
          m.chunks && m.chunks.length
            ? new Blob(m.chunks, { type: m.rec.mimeType || "audio/webm" })
            : null
        );
      };
      try {
        m.rec.requestData();
      } catch (eReq) {}
      try {
        m.rec.stop();
      } catch (eStop) {
        resolve(
          m.chunks && m.chunks.length
            ? new Blob(m.chunks, { type: m.rec.mimeType || "audio/webm" })
            : null
        );
      }
    });
  }

  function storeVoiceForPage(pageNum, blob, transcript, opts) {
    opts = opts || {};
    var prev = state.voiceByPage[pageNum];
    if (prev && prev.url) {
      try {
        URL.revokeObjectURL(prev.url);
      } catch (e) {}
    }
    if (!blob || !blob.size) {
      if (!opts.keepIfMissing) delete state.voiceByPage[pageNum];
      return null;
    }
    var url = URL.createObjectURL(blob);
    // forceTranscript: never keep a previous line when this take has its own words
    var line = "";
    if (opts.forceTranscript) {
      line = transcript || "";
    } else {
      line = transcript || (prev && prev.transcript) || "";
    }
    state.voiceByPage[pageNum] = {
      blob: blob,
      url: url,
      mime: blob.type || "audio/webm",
      transcript: line,
      at: Date.now(),
    };
    return state.voiceByPage[pageNum];
  }

  /**
   * Mix visitor voice under a generated silent/ambient video — so the clip carries your recording.
   */
  function mixVoiceOntoVideo(videoUrl, audioBlob) {
    if (!videoUrl || !audioBlob || !audioBlob.size) {
      return Promise.resolve(null);
    }
    var playSrc =
      String(videoUrl).indexOf("blob:") === 0 || String(videoUrl).indexOf("data:") === 0
        ? videoUrl
        : videoUrl.indexOf("http") === 0 || videoUrl.indexOf("/") === 0
          ? videoUrl
          : videoUrl;

    return Promise.all([
      new Promise(function (resolve, reject) {
        var v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.onloadeddata = function () {
          resolve(v);
        };
        v.onerror = function () {
          reject(new Error("Could not load video for voice mix."));
        };
        v.src = playSrc;
        v.load();
      }),
      audioBlob.arrayBuffer().then(function (buf) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error("No AudioContext");
        var ctx = new Ctx();
        return ctx.decodeAudioData(buf.slice(0)).then(function (decoded) {
          return { ctx: ctx, buffer: decoded };
        });
      }),
    ])
      .then(function (pair) {
        var video = pair[0];
        var audioPack = pair[1];
        var ctx = audioPack.ctx;
        var buffer = audioPack.buffer;
        var w = video.videoWidth || 720;
        var h = video.videoHeight || 1280;
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var c2d = canvas.getContext("2d");
        if (!c2d) throw new Error("No canvas");

        var vStream = canvas.captureStream(30);
        var dest = ctx.createMediaStreamDestination();
        var srcNode = ctx.createBufferSource();
        srcNode.buffer = buffer;
        var gain = ctx.createGain();
        gain.gain.value = 1;
        srcNode.connect(gain);
        gain.connect(dest);

        var mixed = new MediaStream();
        vStream.getVideoTracks().forEach(function (t) {
          mixed.addTrack(t);
        });
        dest.stream.getAudioTracks().forEach(function (t) {
          mixed.addTrack(t);
        });

        // Prefer MP4 when the browser can record it; else WebM (server converts to MP4 on save).
        var mime = "";
        if (typeof MediaRecorder !== "undefined") {
          if (MediaRecorder.isTypeSupported("video/mp4;codecs=avc1,mp4a.40.2"))
            mime = "video/mp4;codecs=avc1,mp4a.40.2";
          else if (MediaRecorder.isTypeSupported("video/mp4")) mime = "video/mp4";
          else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus"))
            mime = "video/webm;codecs=vp9,opus";
          else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus"))
            mime = "video/webm;codecs=vp8,opus";
          else if (MediaRecorder.isTypeSupported("video/webm")) mime = "video/webm";
        }
        if (!mime) throw new Error("MediaRecorder cannot mux video");

        var chunks = [];
        var recorder = new MediaRecorder(mixed, {
          mimeType: mime,
          videoBitsPerSecond: 3500000,
        });
        recorder.ondataavailable = function (ev) {
          if (ev.data && ev.data.size) chunks.push(ev.data);
        };

        return new Promise(function (resolve, reject) {
          var settled = false;
          function done(blob) {
            if (settled) return;
            settled = true;
            try {
              ctx.close();
            } catch (eC) {}
            if (blob && blob.size) {
              // Return both blob URL and blob so we can upload as MP4
              resolve({ url: URL.createObjectURL(blob), blob: blob, mime: blob.type || mime });
            } else reject(new Error("Empty mixed video"));
          }

          recorder.onstop = function () {
            done(new Blob(chunks, { type: mime }));
          };
          recorder.onerror = function () {
            reject(new Error("Voice mix recorder failed"));
          };

          video.currentTime = 0;
          video.play().catch(function () {});
          srcNode.start(0);
          recorder.start(120);

          function draw() {
            if (settled) return;
            try {
              c2d.drawImage(video, 0, 0, w, h);
            } catch (eD) {}
            if (video.ended || video.currentTime >= (video.duration || 10) - 0.05) {
              try {
                srcNode.stop();
              } catch (eS) {}
              try {
                video.pause();
              } catch (eP) {}
              if (recorder.state !== "inactive") recorder.stop();
              return;
            }
            requestAnimationFrame(draw);
          }
          requestAnimationFrame(draw);
          setTimeout(function () {
            if (!settled && recorder.state !== "inactive") {
              try {
                srcNode.stop();
              } catch (eS2) {}
              recorder.stop();
            }
          }, Math.ceil(((video.duration || 10) + 2) * 1000));
        });
      })
      .catch(function (err) {
        console.warn("[book] voice mix failed", err);
        return null;
      });
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  /** Upload blob/file to saved-videos/ as MP4 (server converts WebM when needed). */
  function saveBlobAsMp4(blob, filename) {
    if (!blob || !blob.size) return Promise.reject(new Error("No video blob to save."));
    var form = new FormData();
    form.append("file", blob, filename || "clip.mp4");
    form.append("force_mp4", "1");
    return fetch(apiUrl("/api/save-video"), {
      method: "POST",
      body: form,
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || (d && d.ok === false)) {
          throw new Error((d && d.error) || "Could not save MP4 (" + r.status + ")");
        }
        return d;
      });
    });
  }

  function saveUrlAsMp4(url) {
    if (!url) return Promise.reject(new Error("No video url."));
    if (String(url).indexOf("blob:") === 0) {
      return fetch(url)
        .then(function (r) {
          return r.blob();
        })
        .then(function (blob) {
          return saveBlobAsMp4(blob, "mixed.webm");
        });
    }
    return fetch(apiUrl("/api/save-video"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url, force_mp4: true }),
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || (d && d.ok === false)) {
          throw new Error((d && d.error) || "Could not save MP4");
        }
        return d;
      });
    });
  }

  /**
   * Fold the visitor's spoken *captions* (not raw audio) into scene / motion / audio bed.
   * Video generation uses this text; we never mux microphone audio into the file.
   */
  function applyVoiceContextToBeat(beat, heard, reply) {
    var exact = lastLineClean(heard) || clip(String(heard || "").trim(), 220);
    var tone = (reply && reply.tone) || toneFromSpeech(heard);
    var artLine = clip(
      (reply && reply.text) || "I hear you. I’m right here with you.",
      200
    );
    var turn = (reply && reply.exchangeTurn) || exchangeTurnCount(beat);
    var cont = !!(beat.imageUrl || beat.videoUrl || beat.playUrl || beat.continuityRef);
    var eventBeat = (reply && reply.eventBeat) || "";

    // Keep rolling dialogue history for generation (not a full dump)
    var recentChat = ((beat.conversation || []).slice(-6) || [])
      .map(function (t) {
        if (!t) return "";
        if (t.role === "you") return "YOU: " + clip(t.text, 80);
        if (t.role === "art") return "ART: " + clip(t.text, 80);
        return "";
      })
      .filter(Boolean)
      .join(" / ");

    var visualBrief = cont
      ? "CONTINUATION (exchange #" +
        turn +
        ") — NOT a new intro. " +
        "Start from the attached LAST FRAME of the prior clip / prior still. Same subjects, wardrobe, space. " +
        "Visitor’s new line: “" +
        exact +
        "”. Art answers: “" +
        artLine +
        "”. " +
        "Escalate the same conversation. Recent beats: " +
        clip(recentChat, 280) +
        ". Spell DNA = style tint only. No readable text."
      : "OPENING STASIS (first talk on this page): Visitor: “" +
        exact +
        "”. Art: “" +
        artLine +
        "”. Human, eventful. Spell DNA = style only. No readable text.";

    // Do NOT strip entire script every turn — only strip old LIVE CHAT briefs, keep continuity notes light
    beat.script = stripLiveTalkFromText(beat.script);
    beat.motion = stripLiveTalkFromText(beat.motion);
    beat.audioBridge = stripLiveTalkFromText(beat.audioBridge);
    beat.script = ((beat.script || "").trim() + "\n\n" + visualBrief).trim();
    beat.motion =
      "Fixed camera. CONTINUATION exchange #" +
      turn +
      ". " +
      "EVENTFUL DIALOGUE IN MOTION — art performs: “" +
      artLine +
      "”. " +
      (eventBeat ? "Dramatic beat: “" + clip(eventBeat, 120) + "”. " : "") +
      "Escalate from the previous clip’s last pose — do not reset to an establishing intro. " +
      "Gesture, eyes, breath, light, weight shift. Visitor: “" +
      clip(exact, 100) +
      "”. Tone " +
      tone +
      ". No on-screen text.";
    beat.audioBridge =
      "Continue emotional bed from prior beat if any. Build, peak, soft tail for crossfade into next exchange. " +
      "Spirit of art reply: “" +
      clip(artLine, 90) +
      "” — not visitor mic echo.";
    beat.lastHeard = exact;
    beat.lastArtReply = artLine;
    beat.lastTone = tone;
    beat.exchangeTurn = turn;
    beat.continueScene = cont;
    beat.usedCaptionsOnly = true;
  }

  /**
   * Generate still + video continuing from last video frame when available.
   */
  function generateTalkMedia(side, pageNum) {
    var idx = pageNum - 1;
    if (!window.Movie || !window.Movie.generateVideoOnly) {
      return Promise.reject(new Error("Movie engine not loaded — cannot generate media."));
    }
    var beat = beatAtPage(pageNum);
    setPageStatus(side, "Locking last frame for continuity…", "pending");
    setStatus("Page " + pageNum + " — continuing scene from last frame…", "pending");

    return captureContinuityFrame(beat)
      .then(function (frameData) {
        if (frameData) {
          beat.continuityRef = frameData;
          beat.continueScene = true;
        } else if (beat.imageUrl) {
          beat.continueScene = true;
        }
        persist();
        if (window.Movie.setProject) window.Movie.setProject(state.project);
        setPageStatus(
          side,
          beat.continueScene
            ? "Generating next beat from last frame…"
            : "Generating opening still…",
          "pending"
        );
        return window.Movie.generateVideoOnly(idx);
      })
      .then(function (seg) {
        state.project = window.Movie.getProject() || state.project;
        if (seg && state.project && state.project.segments) {
          // Preserve continuity flags for next turn
          seg.continueScene = true;
          state.project.segments[idx] = seg;
        }
        var out = state.project.segments[idx];
        // Clear heavy data URL from storage after use (keep continueScene + media urls)
        if (out) out.continuityRef = "";
        persist();

        var saveUrl = out.videoUrl || out.playUrl || "";
        if (!saveUrl || String(saveUrl).indexOf("blob:") === 0) {
          writeSideToUi(side, out);
          setPageStatus(side, "Next beat ready (preview). Could not auto-save MP4 yet.", "ok");
          return out;
        }

        setPageStatus(side, "Saving MP4 to saved-videos/…", "pending");
        return saveUrlAsMp4(saveUrl)
          .then(function (saved) {
            if (saved && saved.url) {
              out.videoUrl = saved.url;
              out.playUrl = saved.url;
              out.savedName = saved.name;
              out.savedAsMp4 = true;
            }
            persist();
            writeSideToUi(side, out);
            var msg = saved && saved.name
              ? "Continued scene — saved as " + saved.name
              : "Continued scene ready.";
            setPageStatus(side, msg, "ok");
            setStatus("Page " + pageNum + ": " + msg, "ok");
            return out;
          })
          .catch(function (saveErr) {
            console.warn("[book] MP4 save failed", saveErr);
            out.saveError = (saveErr && saveErr.message) || String(saveErr);
            persist();
            writeSideToUi(side, out);
            setPageStatus(
              side,
              "Continued scene ready. MP4 save failed: " + out.saveError,
              "pending"
            );
            return out;
          });
      });
  }

  function finishTalking(side) {
    var m = state.mic[side];
    if (!m || m.thinking) return;
    var pageNum = side === "left" ? leftPageNum() : rightPageNum();
    var beat = beatAtPage(pageNum);
    var clarityMode = !!m.clarityMode;
    var sessionId = m.sessionId;

    m.recording = false;
    m.thinking = true;
    syncMicButton(side);
    setPageStatus(side, "Finalizing what you just said…", "pending");

    // Stop recognition but wait briefly so last interim can settle into finals
    if (m.recognition) {
      try {
        m.recognition.onend = null;
        m.recognition.stop();
      } catch (e) {}
    }

    var waitMs = 450;
    Promise.all([
      stopRecorderPromise(m),
      new Promise(function (resolve) {
        setTimeout(resolve, waitMs);
      }),
    ])
      .then(function (pair) {
        if (state.mic[side] && state.mic[side].sessionId !== sessionId) return;

        var blob = pair[0];
        if (m.stream) {
          m.stream.getTracks().forEach(function (t) {
            try {
              t.stop();
            } catch (e3) {}
          });
          m.stream = null;
        }
        m.rec = null;
        m.recognition = null;

        // ONLY this session's speech — never previous page transcript
        var heard = sessionSpeechText(m);
        if (clarityMode && m.clarityTranscript) {
          // Clarity re-take: prefer new speech if any; else keep the line being re-spoken
          if (!heard) heard = m.clarityTranscript;
        }

        if (!heard && !(blob && blob.size)) {
          m.thinking = false;
          state.mic[side] = null;
          syncMicButton(side);
          setPageStatus(
            side,
            "No words and no audio captured. Allow the mic, speak clearly (Chrome/Edge), try again.",
            "error"
          );
          return;
        }
        if (!heard) {
          // Audio-only: do NOT recycle an old transcript
          heard = "[Voice captured — no clear transcript this take]";
        }

        // Reject obvious accidental reuse: if identical to last turn and audio is tiny, warn
        if (
          beat.lastHeard &&
          heard === beat.lastHeard &&
          !clarityMode &&
          blob &&
          blob.size > 0
        ) {
          // Still allow if user repeated themselves on purpose; only flag in status
          setStatus("Same words as last turn — if that was wrong, talk again.", "pending");
        }

        var voicePack = storeVoiceForPage(pageNum, blob, heard, { forceTranscript: true });

        // Clarity re-take: better captions for the same intent → regenerate still+video from text
        if (clarityMode) {
          m.thinking = false;
          state.mic[side] = null;
          syncMicButton(side);
          var replyClarity = composeArtReply(heard, beat);
          applyVoiceContextToBeat(beat, heard, replyClarity);
          var logC = ensureConversation(beat);
          logC.push({ role: "you", text: heard + " (clarity re-take)", at: Date.now() });
          logC.push({
            role: "art",
            speaker: replyClarity.speaker,
            text: replyClarity.text,
            at: Date.now(),
          });
          beat.dialogue =
            ((beat.dialogue || "").trim() +
              "\n\n— Clarity re-take —\nYOU\n" +
              heard +
              "\n\n" +
              replyClarity.scriptBlock +
              "\n").trim();
          persist();
          writeSideToUi(side, beat);
          setPageStatus(side, "Art performing its answer…", "pending");
          return performArtReply(replyClarity.text)
            .then(function () {
              setPageStatus(side, "Regenerating still + video…", "pending");
              return generateTalkMedia(side, pageNum);
            })
            .catch(function (err) {
              setPageStatus(
                side,
                "Answer saved but media failed: " + ((err && err.message) || err),
                "error"
              );
            });
        }

        setPageStatus(side, "Art is answering you…", "pending");
        setStatus("Page " + pageNum + " — performing reply (not echoing you).", "pending");

        var reply = composeArtReply(heard, beat);
        var log = ensureConversation(beat);
        log.push({ role: "you", text: heard, at: Date.now() });
        // Only YOU + ART — no intercom echo of the same line (that felt like talking to yourself)
        log.push({
          role: "art",
          speaker: reply.speaker,
          text: reply.text,
          at: Date.now(),
        });
        if (log.length > 24) beat.conversation = log.slice(-24);

        var block =
          "\n\n— Live talk —\nYOU\n" +
          heard +
          "\n\n" +
          reply.scriptBlock +
          "\n";
        beat.dialogue = ((beat.dialogue || "").trim() + block).trim();
        applyVoiceContextToBeat(beat, heard, reply);

        m.thinking = false;
        state.mic[side] = null;
        persist();
        writeSideToUi(side, beat);

        // PERFORM the art’s answer aloud — so you are answered, not left with your own echo
        return performArtReply(reply.text)
          .then(function () {
            setPageStatus(side, "Generating still + video from this exchange…", "pending");
            return generateTalkMedia(side, pageNum);
          })
          .catch(function (err) {
            setPageStatus(
              side,
              "Answer saved, but media failed: " + ((err && err.message) || err),
              "error"
            );
            setStatus("Page " + pageNum + " media failed — try Generate video.", "error");
          });
      })
      .catch(function (err) {
        if (state.mic[side] && state.mic[side].sessionId === sessionId) {
          state.mic[side].thinking = false;
          state.mic[side] = null;
        }
        syncMicButton(side);
        setPageStatus(side, (err && err.message) || "Talk failed.", "error");
      });
  }

  function startClarityRetake(side) {
    var pageNum = side === "left" ? leftPageNum() : rightPageNum();
    var pack = state.voiceByPage[pageNum];
    var beat = beatAtPage(pageNum);
    var line = (pack && pack.transcript) || beat.lastHeard || "";
    if (!line || line.indexOf("[Voice captured") === 0) {
      setPageStatus(side, "No prior line to re-take. Talk to the page first.", "error");
      return;
    }
    startTalking(side);
    if (state.mic[side]) {
      state.mic[side].clarityMode = true;
      state.mic[side].clarityTranscript = line;
      state.mic[side].committed = "";
      state.mic[side].finals = "";
      state.mic[side].interim = "";
    }
    setPageStatus(
      side,
      "Clarity re-take — say this more clearly: “" + clip(line, 100) + "”",
      "pending"
    );
  }

  function toggleTalk(side) {
    var m = state.mic[side];
    if (m && m.thinking) return;
    if (m && m.recording) finishTalking(side);
    else startTalking(side);
  }

  function flushUiToProject() {
    readSideFromUi("left");
    if (rightPageNum() <= TOTAL_PAGES) readSideFromUi("right");
    persist();
  }

  function renderSpread() {
    ensureProject();
    var left = leftPageNum();
    var right = rightPageNum();
    var label = $("bk-spread-label");
    if (label) {
      label.textContent =
        "Pages " + left + (right > left ? "–" + right : "") + " / " + TOTAL_PAGES;
    }
    var jump = $("bk-jump");
    if (jump) jump.value = String(left);

    writeSideToUi("left", beatAtPage(left));
    if (right <= TOTAL_PAGES) {
      $("bk-page-right").style.visibility = "visible";
      writeSideToUi("right", beatAtPage(right));
    } else {
      $("bk-page-right").style.visibility = "hidden";
    }

    var prev = $("bk-prev");
    var next = $("bk-next");
    if (prev) prev.disabled = state.spreadIndex <= 0;
    if (next) next.disabled = state.spreadIndex >= maxSpread();

    var aspectEl = $("bk-aspect");
    if (aspectEl) aspectEl.value = state.aspect;
  }

  function goSpread(idx) {
    flushUiToProject();
    state.spreadIndex = Math.max(0, Math.min(maxSpread(), idx));
    savePrefs();
    renderSpread();
  }

  /**
   * Called by Movie.rollScript so bulk production uses Book text when present.
   */
  function applyToSegments(segments, aspect) {
    ensureProject();
    if (!state.project || !state.project.segments) return;
    var i;
    for (i = 0; i < segments.length; i++) {
      var book = state.project.segments[i];
      if (!book) continue;
      if (book.script) segments[i].script = book.script;
      if (book.dialogue) segments[i].dialogue = book.dialogue;
      if (book.motion) segments[i].motion = book.motion;
      if (book.audioBridge) segments[i].audioBridge = book.audioBridge;
      if (book.act) segments[i].act = book.act;
      segments[i].aspect = aspect || book.aspect || state.aspect;
      if (book.imageUrl) segments[i].imageUrl = book.imageUrl;
      if (book.videoUrl) {
        segments[i].videoUrl = book.videoUrl;
        segments[i].status = "ready";
      }
    }
  }

  function generateSide(side, mode) {
    flushUiToProject();
    var pageNum = side === "left" ? leftPageNum() : rightPageNum();
    if (pageNum > TOTAL_PAGES) return;
    var idx = pageNum - 1;
    var beat = beatAtPage(pageNum);
    beat.aspect = state.aspect;
    persist();

    if (!window.Movie || !window.Movie.generateStillOnly) {
      setPageStatus(side, "Movie engine not loaded.", "error");
      return;
    }

    state.busySide = side;
    setPageStatus(
      side,
      mode === "video" ? "Generating still + video…" : "Generating still…",
      "pending"
    );
    setStatus("Page " + pageNum + " — " + mode + "…", "pending");

    // Ensure Movie holds this project
    if (window.Movie.setProject) window.Movie.setProject(state.project);

    var chain =
      mode === "video"
        ? window.Movie.generateVideoOnly(idx)
        : window.Movie.generateStillOnly(idx);

    chain
      .then(function (seg) {
        state.project = window.Movie.getProject() || state.project;
        if (seg && state.project && state.project.segments) {
          state.project.segments[idx] = seg;
        }
        persist();
        renderSpread();
        setPageStatus(
          side,
          mode === "video"
            ? "Video ready."
            : "Still ready" + (seg && seg.imageUrl ? "." : ""),
          "ok"
        );
        setStatus("Page " + pageNum + " done.", "ok");
      })
      .catch(function (err) {
        setPageStatus(side, (err && err.message) || String(err), "error");
        setStatus("Page " + pageNum + " failed: " + ((err && err.message) || err), "error");
      })
      .finally(function () {
        state.busySide = "";
      });
  }

  function bindUi() {
    var prev = $("bk-prev");
    if (prev) prev.addEventListener("click", function () {
      goSpread(state.spreadIndex - 1);
    });
    var next = $("bk-next");
    if (next) next.addEventListener("click", function () {
      goSpread(state.spreadIndex + 1);
    });
    var jump = $("bk-jump");
    if (jump) {
      jump.addEventListener("change", function () {
        var p = parseInt(jump.value, 10);
        if (!p || p < 1) p = 1;
        if (p > TOTAL_PAGES) p = TOTAL_PAGES;
        goSpread(Math.floor((p - 1) / 2));
      });
    }
    var seed = $("bk-seed");
    if (seed) {
      seed.addEventListener("click", function () {
        if (
          state.project &&
          state.project.segments &&
          state.project.segments.some(function (s) {
            return s.videoUrl || s.imageUrl;
          })
        ) {
          if (
            !window.confirm(
              "Re-seed all 360 pages with new spell-based scripts? Existing stills/videos stay; scripts/motion/audio rewrite."
            )
          ) {
            return;
          }
          reseedCurrentFromSpells();
          return;
        }
        seedPages(TOTAL_PAGES).then(function () {
          state.spreadIndex = 0;
          renderSpread();
        });
      });
    }
    var reseed = $("bk-reseed");
    if (reseed) {
      reseed.addEventListener("click", function () {
        reseedCurrentFromSpells();
      });
    }
    var toMovie = $("bk-to-movie");
    if (toMovie) {
      toMovie.addEventListener("click", function () {
        flushUiToProject();
        var tab = document.querySelector('.site-tabs .tab[data-tab="movie"]');
        if (tab) tab.click();
      });
    }
    var aspect = $("bk-aspect");
    if (aspect) {
      aspect.addEventListener("change", function () {
        state.aspect = aspect.value || "16:9";
        if (state.project) state.project.aspect = state.aspect;
        savePrefs();
        persist();
        renderSpread();
        setStatus(
          "Still + video aspect " +
            state.aspect +
            " — regenerate pages so frames match.",
          "ok"
        );
      });
    }

    ["left", "right"].forEach(function (side) {
      ["script", "dialogue", "motion", "audio"].forEach(function (field) {
        var id = "bk-" + side + "-" + field;
        var el = $(id);
        if (!el) return;
        el.addEventListener("change", function () {
          flushUiToProject();
        });
        el.addEventListener("blur", function () {
          flushUiToProject();
        });
      });
      var gi = $("bk-" + side + "-gen-img");
      if (gi) gi.addEventListener("click", function () {
        generateSide(side, "image");
      });
      var gv = $("bk-" + side + "-gen-vid");
      if (gv) gv.addEventListener("click", function () {
        generateSide(side, "video");
      });
      var mic = $("bk-" + side + "-mic");
      if (mic) {
        mic.addEventListener("click", function () {
          toggleTalk(side);
        });
      }
      var clarity = $("bk-" + side + "-clarity");
      if (clarity) {
        clarity.addEventListener("click", function () {
          startClarityRetake(side);
        });
      }
      var clearChat = $("bk-" + side + "-clear-chat");
      if (clearChat) {
        clearChat.addEventListener("click", function () {
          clearPageChat(side);
        });
      }
      var clearMedia = $("bk-" + side + "-clear-media");
      if (clearMedia) {
        clearMedia.addEventListener("click", function () {
          clearPageMedia(side);
        });
      }
      var clearAll = $("bk-" + side + "-clear-all");
      if (clearAll) {
        clearAll.addEventListener("click", function () {
          clearPageChatAndMedia(side);
        });
      }
    });
  }

  function onShow() {
    ensureProject();
    renderSpread();
    setStatus(
      "Live chat ready — pages " +
        leftPageNum() +
        "–" +
        rightPageNum() +
        ". Press Talk to page on either side.",
      "ok"
    );
  }

  function onHide() {
    ["left", "right"].forEach(function (side) {
      if (state.mic[side] && state.mic[side].recording) {
        try {
          finishTalking(side);
        } catch (e) {
          stopMicTracks(side);
          state.mic[side] = null;
        }
      }
    });
    flushUiToProject();
  }

  function boot() {
    if (!$("panel-book")) return;
    loadPrefs();
    bindUi();
    ensureProject();
    window.dispatchEvent(new Event("book-ready"));
  }

  window.Book = {
    onShow: onShow,
    onHide: onHide,
    applyToSegments: applyToSegments,
    ensureProject: ensureProject,
    seedPages: seedPages,
    reseedCurrentFromSpells: reseedCurrentFromSpells,
    getProject: function () {
      return state.project;
    },
  };
  window.addEventListener("book-show", onShow);
  window.addEventListener("book-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
