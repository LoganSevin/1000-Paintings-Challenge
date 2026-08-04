/**
 * Ears — imagined spell sounds with live equalizer visualization.
 */
(function () {
  "use strict";

  var CAST_TRAY_SLICE = 36;
  var BAR_COUNT = 24;
  var SOUND_DURATION = 180;
  var PREVIEW_DURATION = 28;
  var PREVIEW_STEM_DURATION = 60;
  var INSTANT_DURATION = 10;
  var FULL_CHUNK_SEC = 36;
  var COMPOSE_PREP_TIMEOUT_MS = 45000;
  var RENDER_SAMPLE_RATE = 22050;
  var SAMPLE_RATE = 44100;
  var FETCH_TIMEOUT_MS = 120000;
  var POLL_INTERVAL_MS = 1800;
  var FIRST_POLL_DELAY_MS = 1200;
  var VISION_PLAY_WAIT_MS = 26000;
  var VOCAL_OCTAVE_KEY = "ears-vocal-octave";
  var VOCAL_LEVEL_KEY = "ears-vocal-level";
  var VOCAL_LIVE_BACKING_MUL = 0.52;
  var VOCAL_OCTAVE_WORKLET = "vocal-octave-shift-processor";
  var _vocalOctaveWorkletCtx = null;
  var _vocalOctaveWorkletPromise = null;
  var AUDIO_OUTPUT_KEY = "ears-audio-output";
  var AUDIO_OUTPUT_DEVICES_KEY = "ears-audio-output-devices";

  var COLOR_FALLBACKS = [
    "#c8a8ff",
    "#8860c8",
    "#60a8c8",
    "#c878a8",
    "#a8c878",
    "#e8c878",
  ];

  var state = {
    pool: [],
    poolReady: false,
    trayItems: [],
    applied: [],
    generating: false,
    playing: false,
    active: false,
    drag: null,
    audioCtx: null,
    analyser: null,
    masterGain: null,
    source: null,
    buffer: null,
    rafId: 0,
    freqData: null,
    barCols: [],
    accentColor: COLOR_FALLBACKS[0],
    visionA: "",
    visionB: "",
    visionsGenerating: false,
    paused: false,
    playhead: 0,
    playbackStartCtxTime: 0,
    scrubbing: false,
    promptMood: null,
    remixPending: false,
    stems: null,
    sources: [],
    mixNodes: null,
    playbackRate: 1,
    structureDirty: false,
    composeGen: 0,
    stemsFullReady: false,
    composeProgress: null,
    composeTimer: 0,
    renderMsPerSec: 0,
    liveScore: null,
    livePlayback: false,
    liveEndTimer: 0,
    liveScheduleTimer: 0,
    awaitingFullContinue: false,
    fullBuildActive: false,
    scoreEdit: null,
    scoreRollRaf: 0,
    awaitingVision: false,
    vocal: {
      nodes: null,
      stream: null,
      mode: null,
      liveOn: false,
      recording: false,
      recorder: null,
      chunks: [],
      pitchTimer: 0,
      pitchRaf: 0,
      targetHz: 0,
      currentHz: 0,
      playbackSource: null,
      profile: null,
      capturePoints: [],
      recordStarted: 0,
      recordTimelineOffset: 0,
      streamLiveMode: null,
      octaveShift: 0,
    },
    audioKeepWarm: null,
    outputDeviceId: "",
    knownOutputDevices: [],
    outputEnumBusy: false,
    outputEnumPromise: null,
    mediaLabelsUnlocked: false,
    outputPickerAttempted: false,
  };

  var SCORE_STEM_COLORS = {
    melody: "#a878e8",
    beat: "#e878a8",
    colors: "#60a8c8",
    spells: "#e8c878",
    vocal: "#f0a060",
  };

  var SCORE_LANES = [
    { id: "melody", label: "Melody" },
    { id: "beat", label: "Beat" },
    { id: "vocal", label: "Vocal" },
    { id: "colors", label: "Scene" },
    { id: "spells", label: "Spells" },
  ];
  var SCORE_NOTE_CAP = 4200;
  var SCORE_KIND_COLORS = {
    kick: "#e87898",
    snare: "#f0a060",
    hat: "#c8c0d8",
    bass: "#8878c8",
    melody: null,
    fill: null,
    bell: null,
    accent: null,
  };
  var SCORE_SECTION_COLORS = {
    intro: "rgba(106, 138, 184, 0.22)",
    verse: "rgba(90, 122, 106, 0.18)",
    hook: "rgba(200, 168, 72, 0.28)",
    chorus: "rgba(168, 120, 232, 0.3)",
    bridge: "rgba(120, 136, 168, 0.2)",
    outro: "rgba(136, 104, 120, 0.24)",
  };
  var SCORE_LANE_PAD = 54;
  var scoreAuditionTimer = 0;

  function faderDbFmt(v) {
    if (v <= 0) return "-∞";
    var db = 20 * Math.log10(v / 100);
    return (db > 0 ? "+" : "") + db.toFixed(1) + " dB";
  }

  var MIX_CONTROLS = [
    { id: "ea-volume", valId: "ea-volume-val", fmt: faderDbFmt, live: true },
    { id: "ea-clarity", valId: "ea-clarity-val", fmt: function (v) { return v + "%"; }, live: true },
    { id: "ea-melody", valId: "ea-melody-val", fmt: faderDbFmt, live: true },
    { id: "ea-colors", valId: "ea-colors-val", fmt: faderDbFmt, live: true },
    { id: "ea-spells-mix", valId: "ea-spells-mix-val", fmt: faderDbFmt, live: true },
    { id: "ea-space", valId: "ea-space-val", fmt: function (v) { return v + "%"; }, live: true },
    { id: "ea-tempo", valId: "ea-tempo-val", fmt: function (v) { return v + "%"; }, live: true, tempo: true },
    { id: "ea-density", valId: "ea-density-val", fmt: function (v) { return v + "%"; }, structure: true },
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, kind) {
    var el = $("ea-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "ea-status" + (kind ? " " + kind : "");
  }

  function estimateRenderMs(durationSec, spellCount, isPreview) {
    var base = isPreview ? 4200 : 10000;
    var perSec = state.renderMsPerSec > 50 ? state.renderMsPerSec * 1.45 : isPreview ? 165 : 280;
    var perSpell = isPreview ? 280 : 1500;
    var prep = isPreview ? 1800 : 3200;
    var raw = prep + base + durationSec * perSec + spellCount * perSpell;
    if (state.renderMsPerSec > 50) {
      raw = Math.max(raw, prep + durationSec * state.renderMsPerSec * 1.35);
    }
    return Math.round(raw * 1.5);
  }

  function recordRenderTiming(durationSec, elapsedMs) {
    if (durationSec > 0 && elapsedMs > 800) {
      state.renderMsPerSec = Math.round(elapsedMs / durationSec);
    }
  }

  function renderProgressPct(renderElapsed, estMs) {
    var t = renderElapsed / Math.max(estMs, 1);
    var eased = 1 - Math.exp(-t * 1.85);
    var pct = 14 + eased * 72;
    if (renderElapsed > estMs) {
      var over = renderElapsed - estMs;
      pct += Math.min(4, over / 3500);
    }
    return Math.min(88, pct);
  }

  function tickComposeProgress() {
    var p = state.composeProgress;
    if (!p) return;
    var bar = $("ea-compose-bar");
    var eta = $("ea-compose-eta");
    var lbl = $("ea-compose-label");
    var elapsed = Date.now() - p.start;
    var renderElapsed = p.renderStart ? Date.now() - p.renderStart : 0;
    var pct;
    var statusMsg;

    if (p.phase === "audible") {
      pct = 100;
      if (eta) eta.textContent = "playing";
      statusMsg = p.readyMsg || "Now playing";
    } else if (p.phase === "play") {
      pct = 96;
      if (eta) eta.textContent = "starting…";
      statusMsg = (p.readyMsg || "Audio ready") + " — starting playback…";
    } else if (p.phase === "decode") {
      pct = 92;
      if (eta) eta.textContent = "buffers ready";
      statusMsg = p.label + " — buffers ready, cueing speakers…";
    } else if (!p.renderStart) {
      var prepEst = Math.max(2000, p.estMs * 0.35);
      if (p.prepStep === "notes") pct = 8;
      else if (p.prepStep === "scored") pct = 55;
      else if (p.prepStep === "vision") pct = 72;
      else if (p.prepStep === "foundation") pct = 5;
      else if (p.prepStep === "scene") pct = 9;
      else if (p.prepStep && p.prepStep.indexOf("spell-") === 0) pct = 11;
      else pct = Math.min(12, (elapsed / prepEst) * 12);
      if (eta) {
        eta.textContent = p.prepStep
          ? p.prepStep.replace("spell-", "spell ") + "…"
          : elapsed > COMPOSE_PREP_TIMEOUT_MS * 0.6
            ? "still scoring…"
            : "scoring…";
      }
      if (p.prepStep === "scored") statusMsg = p.label + " — score ready, waiting for vision…";
      else if (p.prepStep === "vision") statusMsg = p.label + " — painting vision behind the bars…";
      else statusMsg = p.label + " — building score from your prompt…";
    } else {
      pct = renderProgressPct(renderElapsed, p.estMs);
      if (renderElapsed > p.estMs) {
        var overSec = Math.ceil((renderElapsed - p.estMs) / 1000);
        if (eta) eta.textContent = "+" + overSec + "s past est.";
        statusMsg = p.label + " — still rendering (" + Math.floor(renderElapsed / 1000) + "s)…";
      } else {
        var leftSec = Math.max(1, Math.ceil((p.estMs - renderElapsed) / 1000));
        if (eta) eta.textContent = "~" + leftSec + "s left";
        statusMsg = p.label + " — ~" + leftSec + "s until audible…";
      }
    }

    if (bar) bar.style.width = pct + "%";
    if (lbl) lbl.textContent = p.label;
    if (statusMsg && p.phase !== "audible") setStatus(statusMsg, "pending");
  }

  function startComposeProgress(label, estMs, silent) {
    cancelComposeProgress(false);
    state.composeProgress = {
      label: label,
      start: Date.now(),
      estMs: Math.max(4500, estMs),
      durationSec: 0,
      renderStart: 0,
      phase: "prep",
      prepStep: "",
      readyMsg: "",
      silent: !!silent,
      done: false,
    };
    var box = $("ea-compose-progress");
    if (box) box.hidden = !!silent;
    if (!silent) {
      tickComposeProgress();
      state.composeTimer = setInterval(tickComposeProgress, 200);
    }
  }

  function markComposeRenderingStart() {
    if (!state.composeProgress) return;
    state.composeProgress.renderStart = Date.now();
    state.composeProgress.phase = "render";
    tickComposeProgress();
  }

  function markComposeBuffersReady(readyMsg) {
    var p = state.composeProgress;
    if (!p || p.silent) return;
    if (p.renderStart) {
      recordRenderTiming(p.durationSec || 0, Date.now() - p.renderStart);
    }
    p.readyMsg = readyMsg || "Audio ready";
    p.phase = "decode";
    tickComposeProgress();
  }

  function markComposePlaybackStarting() {
    var p = state.composeProgress;
    if (!p || p.silent) return;
    p.phase = "play";
    tickComposeProgress();
  }

  function markComposeAudible(readyMsg) {
    var p = state.composeProgress;
    var bar = $("ea-compose-bar");
    var eta = $("ea-compose-eta");
    var lbl = $("ea-compose-label");
    if (p && !p.silent) {
      p.readyMsg = readyMsg || p.readyMsg || "Now playing";
      p.phase = "audible";
      p.done = true;
      if (bar) bar.style.width = "100%";
      if (eta) eta.textContent = "playing";
      if (lbl) lbl.textContent = p.readyMsg;
    }
    if (state.composeTimer) {
      clearInterval(state.composeTimer);
      state.composeTimer = 0;
    }
  }

  function hideComposeProgress() {
    var box = $("ea-compose-progress");
    var bar = $("ea-compose-bar");
    state.composeProgress = null;
    if (box) box.hidden = true;
    if (bar) bar.style.width = "0%";
  }

  function cancelComposeProgress(hide) {
    if (state.composeTimer) {
      clearInterval(state.composeTimer);
      state.composeTimer = 0;
    }
    state.composeProgress = null;
    if (hide !== false) hideComposeProgress();
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeSpell(item) {
    item = item || {};
    var num = item.paintingNum || item.number || null;
    if (num && !item.analysis && window.getGalleryAnalysis) {
      item.analysis = window.getGalleryAnalysis(num);
    }
    return {
      url: item.url || "",
      label: item.label || (num ? "#" + num : "Spell"),
      paintingNum: num,
      title: item.title || (item.analysis && item.analysis.title) || item.label || "",
      tags: item.tags || (item.analysis && item.analysis.tags) || [],
      colors: item.colors || (item.analysis && item.analysis.colors) || [],
      analysis: item.analysis || null,
    };
  }

  function spellRow(m) {
    var num = m.number;
    var analysis = window.getGalleryAnalysis ? window.getGalleryAnalysis(num) : null;
    return normalizeSpell({
      number: num,
      url: window.getPaintingUrl ? window.getPaintingUrl(num) : "paintings/" + num + ".jpg",
      analysis: analysis,
      title: (analysis && analysis.title) || "Painting #" + num,
      tags: (analysis && analysis.tags) || [],
      colors: (analysis && analysis.colors) || [],
      paintingNum: num,
      label: "#" + num,
    });
  }

  function tagBlob(spell) {
    return ((spell.tags || []).join(" ") + " " + String((spell.analysis && spell.analysis.mood) || "") + " " + String((spell.analysis && spell.analysis.style) || "")).toLowerCase();
  }

  function spellAccentColor(spell, idx) {
    var colors = spell.colors || (spell.analysis && spell.analysis.colors) || [];
    if (colors.length) {
      var c = String(colors[0]).trim();
      if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
    }
    return COLOR_FALLBACKS[idx % COLOR_FALLBACKS.length];
  }

  var ARCHETYPE_LABELS = {
    water: "flowing chord pads & gentle 16th arpeggios",
    fire: "warm progression with bright top-line melody",
    crystal: "clear bell chords on the bar grid",
    wind: "breathy pads tied to each chord change",
    earth: "steady rhythmic pulse on beats 1 & 3",
    garden: "melodic motifs locked to the progression",
    choir: "harmony stacks holding through each bar",
    void: "slow minor progression & sustained tones",
    ink: "plucked arpeggios on the sixteenth grid",
    pulse: "continuous groove in 4/4 with chord roots",
  };

  var REGISTER_LIFT = 1.55;
  var MIN_PLAY_OCTAVE = 2;

  var CHORD_PROGRESSIONS = {
    major: [
      [0, 2, 4],
      [3, 2, 4],
      [1, 3, 4],
      [2, 4, 1],
      [0, 2, 4],
      [3, 2, 4],
      [1, 3, 4],
      [4, 2, 0],
    ],
    minor: [
      [0, 2, 4],
      [3, 1, 4],
      [1, 3, 4],
      [4, 2, 1],
      [0, 2, 4],
      [3, 1, 4],
      [2, 4, 1],
      [1, 3, 4],
    ],
    penta: [
      [0, 2, 4],
      [2, 4, 1],
      [1, 3, 4],
      [3, 4, 2],
      [0, 2, 4],
      [2, 4, 1],
      [1, 3, 4],
      [4, 2, 0],
    ],
  };

  var SECTION_PROGRESSIONS = {
    major: {
      intro: [[0, 2, 4], [0, 2, 4]],
      verse: [[0, 2, 4], [0, 2, 4], [3, 2, 4], [3, 2, 4], [1, 3, 4], [1, 3, 4], [2, 4, 1], [2, 4, 1]],
      hook: [[1, 3, 4], [1, 3, 4], [0, 2, 4], [0, 2, 4]],
      chorus: [[3, 2, 4], [0, 2, 4], [1, 3, 4], [2, 4, 1]],
      bridge: [[1, 3, 4], [2, 4, 1], [3, 2, 4], [0, 2, 4]],
      outro: [[0, 2, 4], [2, 4, 0], [0, 2, 4]],
    },
    minor: {
      intro: [[0, 2, 4], [0, 2, 4]],
      verse: [[0, 2, 4], [0, 2, 4], [3, 1, 4], [3, 1, 4], [1, 3, 4], [1, 3, 4], [4, 2, 1], [4, 2, 1]],
      hook: [[4, 2, 1], [4, 2, 1], [0, 2, 4], [0, 2, 4]],
      chorus: [[3, 1, 4], [0, 2, 4], [1, 3, 4], [4, 2, 1]],
      bridge: [[1, 3, 4], [4, 2, 1], [3, 1, 4], [0, 2, 4]],
      outro: [[0, 2, 4], [4, 2, 0], [0, 2, 4]],
    },
    penta: {
      intro: [[0, 2, 4], [0, 2, 4]],
      verse: [[0, 2, 4], [0, 2, 4], [3, 4, 2], [3, 4, 2], [1, 3, 4], [1, 3, 4], [2, 4, 1], [2, 4, 1]],
      hook: [[1, 3, 4], [1, 3, 4], [0, 2, 4], [0, 2, 4]],
      chorus: [[3, 4, 2], [0, 2, 4], [1, 3, 4], [2, 4, 1]],
      bridge: [[1, 3, 4], [2, 4, 1], [3, 4, 2], [0, 2, 4]],
      outro: [[0, 2, 4], [2, 4, 0], [0, 2, 4]],
    },
  };

  var MELODY_SHAPES = [
    [0, 2, 4, 2, 0, 2, 4, 0],
    [0, 2, 4, 4, 2, 0, 2, 4],
    [0, 0, 2, 4, 4, 2, 0, 0],
    [2, 4, 2, 0, 0, 2, 4, 2],
  ];

  var HOOK_SHAPES = [
    [0, 2, 4, 2, 0, 2, 4, 0],
    [0, 0, 2, 4, 4, 2, 0, 0],
    [2, 4, 4, 2, 0, 2, 4, 2],
    [0, 2, 4, 4, 2, 0, 0, 2],
  ];

  var CHORUS_SHAPES = [
    [0, 2, 4, 4, 2, 0, 2, 4],
    [0, 2, 4, 2, 4, 2, 0, 2],
    [2, 4, 2, 0, 0, 2, 4, 4],
    [0, 0, 2, 4, 4, 2, 0, 2],
  ];

  var SONG_PLAN = [
    { type: "intro", share: 0.06, min: 4 },
    { type: "verse", share: 0.11, min: 6 },
    { type: "hook", share: 0.06, min: 4 },
    { type: "chorus", share: 0.11, min: 8 },
    { type: "verse", share: 0.09, min: 6 },
    { type: "hook", share: 0.05, min: 4 },
    { type: "chorus", share: 0.11, min: 8 },
    { type: "bridge", share: 0.08, min: 5 },
    { type: "chorus", share: 0.11, min: 8 },
    { type: "outro", share: 0, min: 0 },
  ];

  var ARPEGGIO_PATTERNS = [
    [0, 2, 4, 2, 0, 1, 3, 2],
    [0, 1, 2, 4, 2, 1, 0, 2],
    [2, 4, 1, 2, 4, 3, 1, 0],
    [0, 2, 1, 2, 4, 2, 0, 1],
  ];

  var SCALE_MAJOR = [1, 1.25, 1.5, 1.875, 2];
  var SCALE_MINOR = [1, 1.2, 1.5, 1.6, 2];
  var SCALE_PENTA = [1, 1.125, 1.25, 1.5, 1.667];
  var KEY_ROOTS = [65.41, 73.42, 82.41, 87.31, 98.0, 110.0];

  function seededRandom(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  var ARCHETYPE_POOL = ["water", "fire", "crystal", "wind", "earth", "garden", "choir", "void", "pulse", "ink"];
  var SFX_POOL = [
    "speech", "whisper", "crowd", "shout", "laugh", "cry", "dog", "cat", "bird", "cow", "horse", "wolf",
    "sheep", "pig", "rooster", "insect", "frog", "roar", "footsteps", "door_slam", "door_creak", "knock",
    "hit", "hit_wood", "hit_metal", "hit_glass", "hit_stone", "glass_break", "splash", "thunder", "crack",
    "explosion", "siren", "bell_sfx", "gunshot", "traffic", "typing", "phone", "tick", "eating",
    "fire_crackle", "rain", "gust", "rustle",
  ];

  var SFX_LABELS = {
    speech: "human voices",
    whisper: "whispers",
    crowd: "crowd chatter",
    shout: "shouts",
    laugh: "laughter",
    cry: "crying",
    dog: "dog barks",
    cat: "cat sounds",
    bird: "bird calls",
    cow: "cow moos",
    horse: "horse neighs",
    wolf: "wolf howls",
    sheep: "sheep bleats",
    pig: "pig snorts",
    rooster: "rooster crows",
    insect: "insect buzz",
    frog: "frog croaks",
    roar: "animal roars",
    hit_wood: "wood impacts",
    hit_metal: "metal clangs",
    hit_glass: "glass taps",
    hit_stone: "stone thuds",
    hit: "impacts",
    footsteps: "footsteps",
    door_slam: "door slams",
    door_creak: "creaks",
    knock: "knocks",
    splash: "splashes",
    thunder: "thunder",
    crack: "cracks & snaps",
    explosion: "explosions",
    siren: "sirens",
    bell_sfx: "bell strikes",
    gunshot: "gunshots",
    glass_break: "glass breaking",
    traffic: "traffic & engines",
    typing: "typing",
    phone: "phone rings",
    tick: "clock ticks",
    eating: "eating sounds",
    fire_crackle: "fire crackle",
    rain: "raindrops",
    gust: "wind gusts",
    rustle: "rustles & movement",
  };

  function defaultPromptMood() {
    return {
      text: "",
      archetypes: [],
      sfx: [],
      density: 1,
      tempo: 1,
      register: 1,
      space: 0.32,
      brightness: 1,
      labels: [],
      words: [],
    };
  }

  function fnv1a(str, seed) {
    var h = seed == null ? 2166136261 : seed;
    var i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function deriveMoodFingerprint(mood) {
    var text = mood.text;
    var h0 = fnv1a(text, 0);
    var archScore = {};
    var sfxScore = {};
    var i;
    var w;
    var h;
    var arch;
    var sfx;

    mood.words.forEach(function (word, idx) {
      h = fnv1a(word.toLowerCase(), fnv1a(text, idx + 1));
      arch = ARCHETYPE_POOL[h % ARCHETYPE_POOL.length];
      archScore[arch] = (archScore[arch] || 0) + 1 + (word.length % 4) * 0.18;
      sfx = SFX_POOL[(h >> 9) % SFX_POOL.length];
      sfxScore[sfx] = (sfxScore[sfx] || 0) + 0.9 + (idx % 4) * 0.1;
      if (word.length > 3) {
        sfx = SFX_POOL[(h >> 17) % SFX_POOL.length];
        sfxScore[sfx] = (sfxScore[sfx] || 0) + 0.55;
      }
    });

    for (i = 0; i < mood.words.length - 1; i++) {
      h = fnv1a(mood.words[i] + " " + mood.words[i + 1], h0);
      arch = ARCHETYPE_POOL[(h >> 5) % ARCHETYPE_POOL.length];
      archScore[arch] = (archScore[arch] || 0) + 0.75;
      sfx = SFX_POOL[(h >> 13) % SFX_POOL.length];
      sfxScore[sfx] = (sfxScore[sfx] || 0) + 0.65;
    }

    mood._archScore = archScore;
    mood._sfxScore = sfxScore;
    mood.fingerprint = h0;

    if (mood.tempo === 1) mood.tempo = 0.8 + ((h0 >> 3) % 65) / 100;
    if (mood.density === 1) mood.density = 0.7 + ((h0 >> 11) % 70) / 100;
    if (mood.space === 0.32) mood.space = 0.1 + ((h0 >> 19) % 72) / 100;
    if (mood.register === 1) mood.register = 0.86 + ((h0 >> 27) % 48) / 100;
    if (mood.brightness === 1) mood.brightness = 0.88 + ((h0 >> 15) % 55) / 100;

    var vowels = (text.match(/[aeiou]/gi) || []).length;
    var ratio = vowels / Math.max(1, text.length);
    mood.scaleHint = ratio > 0.38 ? "major" : ratio < 0.26 ? "minor" : "penta";
  }

  function finalizeMoodFromFingerprint(mood) {
    var archList = Object.keys(mood._archScore || {}).sort(function (a, b) {
      return (mood._archScore[b] || 0) - (mood._archScore[a] || 0);
    });
    var sfxList = Object.keys(mood._sfxScore || {}).sort(function (a, b) {
      return (mood._sfxScore[b] || 0) - (mood._sfxScore[a] || 0);
    });
    var i;
    var type;

    mood.archetypes.forEach(function (arch) {
      mood._archScore[arch] = (mood._archScore[arch] || 0) + 2.2;
    });
    mood.sfx.forEach(function (s) {
      mood._sfxScore[s.type] = (mood._sfxScore[s.type] || 0) + s.weight * 2.2;
    });

    archList = Object.keys(mood._archScore).sort(function (a, b) {
      return mood._archScore[b] - mood._archScore[a];
    });
    sfxList = Object.keys(mood._sfxScore).sort(function (a, b) {
      return mood._sfxScore[b] - mood._sfxScore[a];
    });

    if (!archList.length) archList = [ARCHETYPE_POOL[mood.fingerprint % ARCHETYPE_POOL.length]];
    mood.archetypes = archList.slice(0, 4);
    mood.primaryArchetype = archList[0];

    var sfxCount = Math.min(8, Math.max(3, 2 + Math.floor(mood.words.length / 2)));
    if (!sfxList.length) {
      for (i = 0; i < sfxCount; i++) {
        type = SFX_POOL[(mood.fingerprint + i * 97) % SFX_POOL.length];
        mood._sfxScore[type] = 1;
        sfxList.push(type);
      }
    }
    mood.sfx = sfxList.slice(0, sfxCount).map(function (t) {
      return { type: t, weight: Math.min(1.45, mood._sfxScore[t] || 1) };
    });

    mood.labels = mood.words.slice(0, 6);
    mood.sfxDominant = mood.sfx.length >= 1;
    mood.wordSceneMap = mood.words.slice(0, 14).map(function (word, idx) {
      var h = fnv1a(word, (mood.fingerprint || 0) + idx * 17);
      return {
        word: word,
        type: SFX_POOL[h % SFX_POOL.length],
        weight: 1 + (word.length % 4) * 0.14,
        barOffset: h % 5,
        step: 2 + (h % 3),
      };
    });
    delete mood._archScore;
    delete mood._sfxScore;
  }

  function analyzeListeningPrompt(text) {
    var mood = defaultPromptMood();
    mood.text = String(text || "").trim();
    if (!mood.text) return mood;

    var t = mood.text.toLowerCase();
    mood.words = t
      .replace(/[^a-z0-9\s',.-]/g, " ")
      .split(/[\s,.;:!?-]+/)
      .filter(function (w) {
        return w.length > 1;
      });

    function addArch(arch) {
      if (mood.archetypes.indexOf(arch) < 0) mood.archetypes.push(arch);
    }

    function addSfx(type, weight) {
      weight = weight == null ? 1 : weight;
      var existing = mood.sfx.filter(function (s) {
        return s.type === type;
      })[0];
      if (existing) {
        existing.weight = Math.max(existing.weight, weight);
        return;
      }
      mood.sfx.push({ type: type, weight: weight });
    }

    if (/people|person|human|talk|talking|speak|speaking|conversation|dialogue|voice|voices|murmur|chatter|say|saying|chat|chatting/.test(t)) addSfx("speech", 1.1);
    if (/whisper|mumble|hush|quiet voice/.test(t)) addSfx("whisper", 1.2);
    if (/crowd|babble|market|party|busy|gathering|audience|stadium|cafeteria|restaurant|pub|bar\b|festival/.test(t)) {
      addSfx("crowd", 1.35);
      addSfx("speech", 0.85);
    }
    if (/shout|yell|scream|holler|roar\b|bellow/.test(t)) addSfx("shout", 1.2);
    if (/laugh|laughter|giggle|chuckle|guffaw/.test(t)) addSfx("laugh", 1.1);
    if (/cry|sob|weep|wail|moan\b/.test(t)) addSfx("cry", 1.1);

    if (/dog|bark|barking|puppy|hound|woof/.test(t)) addSfx("dog", 1.2);
    if (/cat|meow|kitten|purr|hiss/.test(t)) addSfx("cat", 1.15);
    if (/bird|chirp|tweet|songbird|crow|caw|owl|hoot|peep|squawk|pigeon|dove/.test(t)) addSfx("bird", 1.2);
    if (/cow|moo|cattle|bull\b/.test(t)) addSfx("cow", 1.1);
    if (/horse|neigh|stallion|mare|hoof/.test(t)) addSfx("horse", 1.15);
    if (/wolf/.test(t) || (/\bhowl/.test(t) && !/wind|gust|breeze/.test(t))) addSfx("wolf", 1.2);
    if (/sheep|bleat|lamb/.test(t)) addSfx("sheep", 1.05);
    if (/pig|oink|hog|squeal/.test(t)) addSfx("pig", 1.05);
    if (/rooster|cock-a|cluck|chicken|hen/.test(t)) addSfx("rooster", 1.1);
    if (/cricket|insect|buzz|bee|wasp|fly\b|mosquito/.test(t)) addSfx("insect", 1.05);
    if (/frog|croak|toad/.test(t)) addSfx("frog", 1.1);
    if (/lion|tiger|bear|growl|roar/.test(t)) addSfx("roar", 1.15);

    if (/footstep|footsteps|walk|walking|step|steps|stomp|stomping|running|run\b|jog|march/.test(t)) addSfx("footsteps", 1.15);
    if (/door slam|slam|slammed|bang\b|banged/.test(t)) addSfx("door_slam", 1.2);
    if (/creak|squeak|groan\b/.test(t)) addSfx("door_creak", 1.1);
    if (/knock|knocking|rapping|rap\b|pound\b/.test(t)) addSfx("knock", 1.1);

    if (/hit|strike|slap|punch|kick|smack|thud|impact|collide|collision|smash|whack|clobber/.test(t)) {
      if (/wood|wooden|table|plank|timber|branch|stick/.test(t)) addSfx("hit_wood", 1.25);
      else if (/metal|iron|steel|anvil|sword|clang|brass|copper|hammer/.test(t)) addSfx("hit_metal", 1.25);
      else if (/glass|window|pane/.test(t)) addSfx("hit_glass", 1.2);
      else if (/stone|rock|concrete|brick|marble|gravel/.test(t)) addSfx("hit_stone", 1.2);
      else addSfx("hit", 1.1);
    }
    if (/shatter|breaking glass|glass break|smash glass/.test(t)) addSfx("glass_break", 1.3);
    if (/splash|plunge|dive|water hit/.test(t)) addSfx("splash", 1.1);
    if (/thunder|lightning/.test(t)) addSfx("thunder", 1.2);
    if (/crack|snap|break\b|splinter|pop\b/.test(t)) addSfx("crack", 1.05);
    if (/explosion|explode|blast|boom\b|detonat/.test(t)) addSfx("explosion", 1.3);
    if (/siren|alarm|alert/.test(t)) addSfx("siren", 1.15);
    if (/bell ring|gong|chime ring|church bell|doorbell/.test(t)) addSfx("bell_sfx", 1.1);
    if (/gun|gunshot|rifle|pistol|shot\b|firing/.test(t)) addSfx("gunshot", 1.25);
    if (/car|engine|traffic|horn|vehicle|truck|bus\b|motor|train|plane|airplane/.test(t)) addSfx("traffic", 1.1);
    if (/type|typing|keyboard|keystroke/.test(t)) addSfx("typing", 1.05);
    if (/phone|ring\b|buzz\b|cell|mobile/.test(t)) addSfx("phone", 1.05);
    if (/clock|tick|ticking/.test(t)) addSfx("tick", 1.05);
    if (/chew|eating|bite|crunch food|munch/.test(t)) addSfx("eating", 1.0);
    if (/crackle|popping fire|campfire/.test(t)) addSfx("fire_crackle", 1.1);

    if (/ocean|sea|tide|surf|shore|beach/.test(t)) addArch("water");
    if (/rain|drizzle|storm|wet|puddle/.test(t)) addArch("water");
    if (/river|stream|creek|brook|flow/.test(t)) addArch("water");
    if (/fire|flame|ember|burn|ash|heat|coals/.test(t)) addArch("fire");
    if (/bell|chime|crystal|glass|shimmer|ring|silver/.test(t)) addArch("crystal");
    if (/wind|gust|breeze|air|howl|draft/.test(t)) addArch("wind");
    if (/stone|rock|cave|mountain|earth|wood|door/.test(t)) addArch("earth");
    if (/forest|garden|leaf|meadow|rustle|trees/.test(t)) addArch("garden");
    if (/choir|hymn|soft|calm|dream|tender|lull/.test(t)) addArch("choir");
    if (/dark|void|deep|shadow|night|abyss|hollow/.test(t)) addArch("void");
    if (/beat|pulse|ritual|drum|march|clock|step/.test(t)) addArch("pulse");
    if (/ink|brush|grain|charcoal|paper|scratch|scrib/.test(t)) addArch("ink");

    if (/fast|rush|urgent|quick|sprint|flutter/.test(t)) mood.tempo = Math.max(mood.tempo, 1.4);
    if (/slow|drift|linger|vast|long|patient/.test(t)) mood.tempo = Math.min(mood.tempo, 0.65);
    if (/dense|thick|heavy|layer|crowd|rich/.test(t)) mood.density = Math.max(mood.density, 1.4);
    if (/sparse|minimal|quiet|thin|bare|empty/.test(t)) mood.density = Math.min(mood.density, 0.6);
    if (/cathedral|hall|echo|cavern|vast|distant|far/.test(t)) mood.space = Math.max(mood.space, 0.75);
    if (/intimate|close|whisper|near|small|tight/.test(t)) mood.space = Math.min(mood.space, 0.12);
    if (/bright|sun|gold|morning|gleam/.test(t)) {
      mood.brightness = Math.max(mood.brightness, 1.35);
      mood.register *= 1.12;
      mood.scaleHint = "major";
    }
    if (/low|bass|rumble|sub|under/.test(t)) mood.register *= 0.9;
    if (/high|tin|sharp|bright|treble/.test(t)) mood.register *= 1.28;
    if (/dark|night|shadow|sad|void|lonely|minor/.test(t)) mood.scaleHint = "minor";
    if (/bright|sun|gold|joy|morning|hope|major/.test(t)) mood.scaleHint = "major";

    if (/rain|drizzle|downpour|shower|raindrop/.test(t)) addSfx("rain", 1.25);
    if (/rustle|shuffle|brush past|leaves|foliage|sway/.test(t)) addSfx("rustle", 1.1);
    if (/gust|whoosh|swirl|blast of air/.test(t)) addSfx("gust", 1.15);

    if (!mood.words.length && mood.text) {
      mood.words = mood.text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(function (w) {
          return w.length > 0;
        });
      if (!mood.words.length) mood.words = [mood.text.toLowerCase().slice(0, 48) || "sound"];
    }

    deriveMoodFingerprint(mood);
    finalizeMoodFromFingerprint(mood);
    return mood;
  }

  function spellsSignature(spells) {
    return (spells || [])
      .map(function (s) {
        return String(s.paintingNum || 0) + ":" + resolveArchetype(s).charAt(0);
      })
      .join(",");
  }

  function promptToKey(mood, spells) {
    var hash = 0;
    var src = (mood.text || "spell gallery ears") + "|" + spellsSignature(spells);
    var i;
    for (i = 0; i < src.length; i++) hash = (hash + src.charCodeAt(i) * (i + 1)) | 0;
    var root =
      KEY_ROOTS[Math.abs(hash) % KEY_ROOTS.length] * (mood.register || 1) * REGISTER_LIFT;
    var ratios = SCALE_PENTA;
    var t = (mood.text || "").toLowerCase();
    if (mood.scaleHint === "minor" || /dark|night|shadow|sad|void|lonely|minor/.test(t)) ratios = SCALE_MINOR;
    else if (mood.scaleHint === "major" || /bright|sun|gold|joy|morning|hope|major/.test(t)) ratios = SCALE_MAJOR;
    if (spells && spells.length >= 3) root *= 1.04;
    return { root: root, ratios: ratios, hash: hash };
  }

  function spellKey(spell, index, baseKey) {
    var n = spell.paintingNum || 1;
    var shift = ((n * 3 + index * 5) % 7) - 3;
    var mul = Math.pow(2, shift / 12);
    return {
      root: baseKey.root * mul,
      ratios: baseKey.ratios,
      shift: shift,
    };
  }

  function spellTimbre(archetype) {
    var map = {
      crystal: { wave: "sine", octave: 5, bright: 1.2, filterHz: 4800, detune: 8, harmonicMix: 0.42 },
      fire: { wave: "sawtooth", octave: 4, bright: 1.15, filterHz: 1400, detune: -10, noiseMix: 0.12 },
      pulse: { wave: "square", octave: 3, bright: 1.05, filterHz: 900, detune: 0, harmonicMix: 0.28 },
      earth: { wave: "triangle", octave: 3, bright: 0.95, filterHz: 520, detune: -6 },
      void: { wave: "sine", octave: 3, bright: 0.88, filterHz: 380, detune: -14, harmonicMix: 0.18 },
      ink: { wave: "triangle", octave: 4, bright: 1.1, filterHz: 2200, detune: 4 },
      water: { wave: "sine", octave: 5, bright: 1.08, filterHz: 3200, detune: 6, harmonicRatio: 3, harmonicMix: 0.3 },
      wind: { wave: "sine", octave: 5, bright: 1.0, filterHz: 3600, detune: 18, slideTo: 1.04 },
      garden: { wave: "triangle", octave: 4, bright: 1.12, filterHz: 2600, detune: -3, harmonicMix: 0.35 },
      choir: { wave: "sine", octave: 3, bright: 1.0, filterHz: 1100, detune: -5, harmonicMix: 0.48 },
    };
    return map[archetype] || map.choir;
  }

  function sceneTimbre(type) {
    if (type === "rain" || type === "splash" || type === "gust" || type === "wind") {
      return { wave: "sine", filterHz: 4200, detune: 14, harmonicMix: 0.22, kind: "scene" };
    }
    if (type === "fire_crackle" || type === "crack" || type === "rustle") {
      return { wave: "triangle", filterHz: 2800, noiseMix: 0.28, noiseFilter: 2400, kind: "scene" };
    }
    if (type === "bell_sfx" || type === "phone" || type === "tick") {
      return { wave: "sine", filterHz: 5200, harmonic: true, harmonicRatio: 2.5, harmonicMix: 0.55, kind: "bell" };
    }
    if (type === "hit" || type.indexOf("hit_") === 0 || type === "door_slam" || type === "knock" || type === "glass_break" || type === "thunder") {
      return { wave: "square", filterHz: 1800, noiseMix: 0.45, noiseFilter: 1600, kind: "impact" };
    }
    if (type === "speech" || type === "crowd" || type === "whisper" || type === "choir" || type === "laugh" || type === "cry" || type === "shout") {
      return { wave: "sine", filterHz: 900, detune: -8, harmonic: true, harmonicMix: 0.4, kind: "voice" };
    }
    if (type === "dog" || type === "cat" || type === "bird" || type === "frog" || type === "wolf" || type === "roar" || type === "insect") {
      return { wave: "triangle", filterHz: 3400, detune: 22, kind: "creature" };
    }
    if (type === "siren" || type === "traffic" || type === "explosion" || type === "gunshot") {
      return { wave: "sawtooth", filterHz: 1200, detune: -12, noiseMix: 0.2, kind: "urban" };
    }
    if (type === "footsteps" || type === "typing" || type === "eating") {
      return { wave: "square", filterHz: 2400, noiseMix: 0.18, kind: "rhythm" };
    }
    return { wave: "triangle", filterHz: 2000, detune: (type || "").length * 2, kind: "scene" };
  }

  function kindTimbre(kind) {
    var map = {
      kick: { wave: "sine", filterHz: 120, filterQ: 0.7, filterType: "lowpass", noiseMix: 0.18, noiseFilter: 90, noiseQ: 0.5 },
      bass: { wave: "sine", filterHz: 220, filterQ: 0.5, filterType: "lowpass", detune: 0 },
      snare: { wave: "sine", noiseMix: 0.62, noiseFilter: 2400, noiseQ: 0.7, filterHz: 240, filterQ: 0.6 },
      hat: { wave: "triangle", filterHz: 7000, filterQ: 0.35, filterType: "highpass", noiseMix: 0.55, noiseFilter: 9000, noiseQ: 0.4 },
      melody: { wave: "sine", harmonicMix: 0.18, detune: 0, filterHz: 4200, filterQ: 0.45 },
      fill: { wave: "sine", harmonic: false, harmonicRatio: 2, harmonicMix: 0.22, filterHz: 3600 },
      accent: { wave: "triangle", filterHz: 2400, filterQ: 0.9, harmonicMix: 0.14, detune: 0 },
      spark: { wave: "sine", filterHz: 3800, filterQ: 0.8, detune: 0, harmonicRatio: 2, harmonicMix: 0.12 },
      snap: { wave: "triangle", noiseMix: 0.48, noiseFilter: 1500, filterHz: 2200 },
      bell: { wave: "sine", harmonic: false, harmonicRatio: 2, harmonicMix: 0.2, filterHz: 4000 },
      scene: { wave: "triangle", filterHz: 2400 },
      voice: { wave: "sine", filterHz: 850, harmonic: true, harmonicMix: 0.38 },
      impact: { wave: "square", noiseMix: 0.5, noiseFilter: 1400 },
      creature: { wave: "triangle", filterHz: 3200, detune: 18 },
      urban: { wave: "sawtooth", filterHz: 1100, noiseMix: 0.22 },
      rhythm: { wave: "square", filterHz: 2200, noiseMix: 0.15 },
      pad: { wave: "sine", filterHz: 420, filterQ: 0.3, filterType: "lowpass", harmonicMix: 0.08 },
      arp: { wave: "sine", filterHz: 3200, filterQ: 0.4, harmonicMix: 0.1, detune: 0 },
      note: { wave: "triangle" },
    };
    return map[kind] || map.note;
  }

  function mergeNoteTimbre(kind, overrides) {
    var base = kindTimbre(kind);
    var merged = {};
    var k;
    for (k in base) merged[k] = base[k];
    overrides = overrides || {};
    for (k in overrides) {
      if (overrides[k] != null) merged[k] = overrides[k];
    }
    return merged;
  }

  function archetypeMelodyTimbre(mood, idx) {
    var archs = mood.archetypes && mood.archetypes.length ? mood.archetypes : [mood.primaryArchetype || "choir"];
    return spellTimbre(archs[idx % archs.length]);
  }

  var MELODY_WAVE_ROTATION = ["sine", "triangle", "sine", "triangle"];
  var MELODY_OCTAVE = 5;
  var BASS_OCTAVE = 2;
  var DISPLAY_OCTAVE = 4;

  var ROMAN_MAJOR = ["I", "ii", "iii", "IV", "V"];
  var ROMAN_MINOR = ["i", "ii°", "III", "iv", "v"];
  var ROMAN_PENTA = ["I", "II", "iii", "IV", "V"];

  var SECTION_HARMONY_LABELS = {
    intro: "Intro",
    verse: "Verse",
    hook: "Hook",
    chorus: "Chorus",
    bridge: "Bridge",
    outro: "Outro",
  };

  var _harmonyCtxKey = "";

  function beatPercFreq(kind, key, chord) {
    if (kind === "hat") return 6800;
    if (kind === "snap") return 2200;
    if (kind === "snare") return noteAt(key, chord[0], 2);
    return noteAt(key, chord[0], BASS_OCTAVE);
  }

  function degreeFreq(key, degree) {
    return key.root * key.ratios[degree % key.ratios.length];
  }

  function progressionForKey(key) {
    if (key.ratios === SCALE_MINOR) return CHORD_PROGRESSIONS.minor;
    if (key.ratios === SCALE_MAJOR) return CHORD_PROGRESSIONS.major;
    return CHORD_PROGRESSIONS.penta;
  }

  function scaleKind(key) {
    if (key.ratios === SCALE_MINOR) return "minor";
    if (key.ratios === SCALE_MAJOR) return "major";
    return "penta";
  }

  function scaleDisplayLabel(key) {
    var kind = scaleKind(key);
    if (kind === "penta") return "pentatonic";
    return kind;
  }

  function romanForDegree(key, degree) {
    var table =
      key.ratios === SCALE_MINOR ? ROMAN_MINOR : key.ratios === SCALE_MAJOR ? ROMAN_MAJOR : ROMAN_PENTA;
    return table[degree % table.length] || String(degree + 1);
  }

  function noteLabelAt(key, degree, octave) {
    return midiLabel(freqToMidi(noteAt(key, degree, octave == null ? DISPLAY_OCTAVE : octave)));
  }

  function keyRootName(key) {
    return noteLabelAt(key, 0, DISPLAY_OCTAVE).replace(/\d+$/, "");
  }

  function chordNotesString(key, chord) {
    return (chord || []).map(function (degree) {
      return noteLabelAt(key, degree, DISPLAY_OCTAVE);
    }).join(" ");
  }

  function chordRoman(key, chord) {
    if (!chord || !chord.length) return "—";
    return romanForDegree(key, chord[0]);
  }

  function chordLabel(key, chord) {
    return chordRoman(key, chord) + " · " + chordNotesString(key, chord);
  }

  function formatSectionChordLine(key, chords) {
    return (chords || [])
      .map(function (ch) {
        return chordRoman(key, ch);
      })
      .join(" – ");
  }

  function getHarmonyMood() {
    var analyzed = analyzeListeningPrompt(getEarsPrompt());
    var mood = state.promptMood || analyzed;
    if (state.promptMood) {
      mood = {};
      var k;
      for (k in analyzed) {
        if (Object.prototype.hasOwnProperty.call(analyzed, k)) mood[k] = analyzed[k];
      }
      mood.register = state.promptMood.register;
      mood.scaleHint = state.promptMood.scaleHint;
      mood.tempo = state.promptMood.tempo || mood.tempo;
      mood.text = state.promptMood.text || mood.text;
    }
    return mood;
  }

  function getHarmonyContext() {
    var mood = getHarmonyMood();
    var key = promptToKey(mood, state.applied);
    var dur = bufferDuration() || SOUND_DURATION;
    var comp = buildComposition(mood, dur, key);
    var scale = scaleKind(key);
    return {
      mood: mood,
      key: key,
      comp: comp,
      scale: scale,
      loop: progressionForKey(key),
      sections: SECTION_PROGRESSIONS[scale],
    };
  }

  function harmonyContextKey(ctx) {
    return (
      ctx.key.root +
      "|" +
      ctx.scale +
      "|" +
      Math.round(ctx.comp.bpm) +
      "|" +
      ctx.comp.totalBars +
      "|" +
      (getEarsPrompt() || "") +
      "|" +
      spellsSignature(state.applied) +
      "|" +
      Math.round(getTweaks().tempo * 100)
    );
  }

  function chordAtPlayhead(playhead, ctx) {
    playhead = playhead == null ? 0 : playhead;
    var bar = Math.floor(playhead / ctx.comp.barDur);
    if (bar < 0) bar = 0;
    if (bar >= ctx.comp.totalBars) bar = Math.max(0, ctx.comp.totalBars - 1);
    return {
      bar: bar,
      barInLoop: bar % 8,
      chord: ctx.comp.progression[bar] || ctx.loop[bar % 8],
      section: sectionAt(ctx.comp, bar),
    };
  }

  function buildHarmonyHtml(ctx) {
    var key = ctx.key;
    var scaleNotes = [];
    var d;
    for (d = 0; d < key.ratios.length; d++) {
      scaleNotes.push(
        '<span class="ea-harmony-degree"><em>' +
          escapeHtml(romanForDegree(key, d)) +
          "</em> " +
          escapeHtml(noteLabelAt(key, d, DISPLAY_OCTAVE)) +
          "</span>"
      );
    }

    var loopBars = [];
    var i;
    for (i = 0; i < ctx.loop.length; i++) {
      var ch = ctx.loop[i];
      loopBars.push(
        '<span class="ea-harmony-bar" data-bar="' +
          i +
          '"><span class="ea-harmony-bar-num">bar ' +
          (i + 1) +
          '</span><span class="ea-harmony-bar-roman">' +
          escapeHtml(chordRoman(key, ch)) +
          '</span><span class="ea-harmony-bar-notes">' +
          escapeHtml(chordNotesString(key, ch)) +
          "</span></span>"
      );
    }

    var sectionRows = [];
    var secName;
    var secPool;
    for (secName in ctx.sections) {
      if (!Object.prototype.hasOwnProperty.call(ctx.sections, secName)) continue;
      secPool = ctx.sections[secName];
      sectionRows.push(
        '<div class="ea-harmony-section"><span class="ea-harmony-sec-name">' +
          escapeHtml(SECTION_HARMONY_LABELS[secName] || secName) +
          '</span><span class="ea-harmony-sec-chords">' +
          escapeHtml(formatSectionChordLine(key, secPool)) +
          "</span></div>"
      );
    }

    return (
      '<div class="ea-harmony-grid">' +
      '<div class="ea-harmony-block"><span class="ea-harmony-head">Key &amp; scale</span>' +
      '<span class="ea-harmony-key">' +
      escapeHtml(keyRootName(key) + " " + scaleDisplayLabel(key)) +
      " · " +
      Math.round(ctx.comp.bpm) +
      " BPM" +
      (Math.abs(getTweaks().tempo - 1) > 0.01 ? " · " + Math.round(getTweaks().tempo * 100) + "% speed" : "") +
      "</span>" +
      '<div class="ea-harmony-scale">' +
      scaleNotes.join("") +
      "</div></div>" +
      '<div class="ea-harmony-block"><span class="ea-harmony-head">8-bar loop</span>' +
      '<div class="ea-harmony-bars">' +
      loopBars.join("") +
      "</div></div>" +
      '<div class="ea-harmony-block"><span class="ea-harmony-head">By section</span>' +
      '<div class="ea-harmony-sections">' +
      sectionRows.join("") +
      "</div></div>" +
      '<div class="ea-harmony-now is-idle" data-harmony-now>Ready — press Play to follow chords</div>' +
      "</div>"
    );
  }

  function updateHarmonyPlayhead(playhead, ctx) {
    var el = $("ea-harmony-ref");
    if (!el || !el.querySelector(".ea-harmony-grid")) return;
    ctx = ctx || getHarmonyContext();
    var now = chordAtPlayhead(playhead, ctx);
    var bars = el.querySelectorAll(".ea-harmony-bar[data-bar]");
    var bi;
    for (bi = 0; bi < bars.length; bi++) {
      bars[bi].classList.toggle("is-active", parseInt(bars[bi].dataset.bar, 10) === now.barInLoop);
    }
    var nowEl = el.querySelector("[data-harmony-now]");
    if (!nowEl) return;
    var hasBuf = hasSoundReady();
    if (!hasBuf || (!state.playing && playhead < 0.05)) {
      nowEl.className = "ea-harmony-now is-idle";
      nowEl.textContent = hasBuf ? "Ready — press Play to follow chords" : "Generate sound to hear this progression";
      return;
    }
    nowEl.className = "ea-harmony-now";
    nowEl.textContent =
      "Now · bar " +
      (now.bar + 1) +
      " / " +
      ctx.comp.totalBars +
      " · " +
      (SECTION_HARMONY_LABELS[now.section] || now.section) +
      " · " +
      chordLabel(ctx.key, now.chord);
  }

  function renderHarmonyReference(playhead) {
    var el = $("ea-harmony-ref");
    if (!el) return;
    var prompt = (getEarsPrompt() || "").trim();
    if (!prompt && !state.applied.length) {
      _harmonyCtxKey = "";
      el.innerHTML = '<p class="ea-harmony-empty">Type a prompt or add spells to see the harmony map.</p>';
      return;
    }
    var ctx = getHarmonyContext();
    var hkey = harmonyContextKey(ctx);
    if (hkey !== _harmonyCtxKey) {
      _harmonyCtxKey = hkey;
      el.innerHTML = buildHarmonyHtml(ctx);
    }
    updateHarmonyPlayhead(playhead != null ? playhead : getPlayhead(), ctx);
  }

  function buildSectionProgression(totalBars, sections, key) {
    var pools = SECTION_PROGRESSIONS[scaleKind(key)];
    var progression = [];
    var bar;
    var sec;
    var pool;
    var phraseLen;
    var secBar;
    var prevSec;
    var chordIdx;

    prevSec = "";
    secBar = 0;
    for (bar = 0; bar < totalBars; bar++) {
      sec = sections[bar] || "verse";
      if (sec !== prevSec) {
        secBar = 0;
        prevSec = sec;
      }
      pool = pools[sec] || pools.verse;
      phraseLen = sec === "chorus" || sec === "hook" ? 1 : 2;
      chordIdx = Math.floor(secBar / phraseLen) % pool.length;
      progression.push(pool[chordIdx].slice());
      secBar++;
    }
    return progression;
  }

  function chordToneAt(key, chord, toneIdx, octave) {
    toneIdx = ((toneIdx % chord.length) + chord.length) % chord.length;
    return noteAt(key, chord[toneIdx], octave);
  }

  function applyLegato(notes) {
    var lanes = {};
    var lane;
    var list;
    var i;
    var cur;
    var next;
    var gap;
    var target;
    var legatoKinds = { melody: 1, fill: 1, bass: 1 };

    notes.forEach(function (n) {
      if (!legatoKinds[n.kind]) return;
      lane = n.stem + ":" + n.kind;
      if (!lanes[lane]) lanes[lane] = [];
      lanes[lane].push(n);
    });

    Object.keys(lanes).forEach(function (laneKey) {
      list = lanes[laneKey].sort(function (a, b) {
        return a.t - b.t;
      });
      for (i = 0; i < list.length - 1; i++) {
        cur = list[i];
        next = list[i + 1];
        gap = next.t - cur.t;
        if (gap < 0.03 || gap > 3.2) continue;
        target = gap + (cur.kind === "bass" ? 0.06 : cur.kind === "melody" || cur.kind === "fill" ? 0.1 : 0.05);
        cur.dur = Math.max(cur.dur, Math.min(target, cur.dur * 1.4));
      }
    });
    return notes;
  }

  function buildPreviewSongSections(totalBars) {
    var blueprint = [
      ["intro", 2],
      ["verse", 2],
      ["hook", 2],
      ["chorus", 4],
      ["outro", 1],
    ];
    var blueprintBars = 11;
    var sections = [];
    var assigned = 0;
    var i;
    var type;
    var count;
    var b;
    var remaining;
    var minLeft;
    for (i = 0; i < blueprint.length; i++) {
      type = blueprint[i][0];
      remaining = totalBars - assigned;
      minLeft = blueprint.length - i - 1;
      if (i === blueprint.length - 1) {
        count = remaining;
      } else {
        count = Math.max(type === "intro" || type === "hook" || type === "outro" ? 1 : 1, Math.round((blueprint[i][1] / blueprintBars) * totalBars));
        count = Math.min(count, Math.max(1, remaining - minLeft));
      }
      for (b = 0; b < count; b++) sections.push(type);
      assigned += count;
    }
    while (sections.length < totalBars) sections.push("outro");
    return sections.slice(0, totalBars);
  }

  function buildSongSections(totalBars, duration) {
    if (duration != null && duration <= PREVIEW_DURATION + 2) {
      return buildPreviewSongSections(totalBars);
    }
    var sections = [];
    var i;
    var b;
    var take;
    for (i = 0; i < SONG_PLAN.length - 1; i++) {
      take = Math.max(SONG_PLAN[i].min || 0, Math.round(totalBars * SONG_PLAN[i].share));
      for (b = 0; b < take && sections.length < totalBars; b++) {
        sections.push(SONG_PLAN[i].type);
      }
    }
    while (sections.length < totalBars) sections.push("outro");
    return sections;
  }

  function countSectionBars(comp, type) {
    var bar;
    var n = 0;
    for (bar = 0; bar < comp.totalBars && sectionAt(comp, bar) === type; bar++) n++;
    return n;
  }

  function sectionPeakMul(comp, bar, sec, kind) {
    var beatKinds = { kick: 1, snare: 1, hat: 1, bass: 1, snap: 1 };
    var isBeat = !!beatKinds[kind];
    var introLen;
    var outroStart;
    var outroLen;
    var fade;

    if (sec === "outro") {
      outroStart = comp.outroStart >= 0 ? comp.outroStart : Math.max(0, comp.totalBars - 2);
      outroLen = Math.max(1, comp.totalBars - outroStart);
      fade = 1 - ((bar - outroStart) / outroLen) * 0.88;
      return Math.max(0.1, fade);
    }
    if (sec === "intro") {
      introLen = Math.max(1, countSectionBars(comp, "intro"));
      if (isBeat) return 0.42 + (bar / Math.max(1, introLen - 1)) * 0.58;
      return 0.45 + (bar / Math.max(1, introLen - 1)) * 0.55;
    }
    if (sec === "hook" && kind === "melody") return 1.18;
    if (sec === "chorus" && (kind === "melody" || kind === "fill")) return 1.32;
    if (sec === "verse" && kind === "melody") return 0.92;
    if (sec === "verse" && (kind === "arp" || kind === "pad")) return 1.05;
    return 1;
  }

  function buildComposition(mood, duration, key) {
    var bpm = 92 * (mood.tempo || 1);
    if (mood.tempo > 1.25) bpm = 108 * mood.tempo;
    if (mood.tempo < 0.75) bpm = 76 * mood.tempo;
    var beatDur = 60 / bpm;
    var barDur = beatDur * 4;
    var totalBars = Math.max(4, Math.ceil(duration / barDur));
    var sections = buildSongSections(totalBars, duration);
    var progression = buildSectionProgression(totalBars, sections, key);
    var hash = key.hash || 0;
    var src = (mood.text || "ears") + key.root + (mood.spellSig || "");
    for (var b = 0; b < src.length; b++) hash = (hash + src.charCodeAt(b) * (b + 1)) | 0;
    return {
      bpm: bpm,
      beatDur: beatDur,
      barDur: barDur,
      totalBars: totalBars,
      progression: progression,
      sections: sections,
      duration: duration,
      sixteenth: beatDur / 4,
      eighth: beatDur / 2,
      hookIdx: Math.abs(hash) % HOOK_SHAPES.length,
      chorusIdx: Math.abs(hash >> 3) % CHORUS_SHAPES.length,
      outroStart: sections.indexOf("outro"),
    };
  }

  function sectionAt(comp, bar) {
    return comp.sections[bar] || "verse";
  }

  function barInChunk(comp, bar, renderOpts) {
    renderOpts = renderOpts || {};
    var off = renderOpts.chunkOffset || 0;
    var dur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var globalT = bar * comp.barDur;
    return globalT >= off - 0.001 && globalT < off + dur - 0.001;
  }

  function barLocalTime(comp, bar, renderOpts) {
    renderOpts = renderOpts || {};
    return bar * comp.barDur - (renderOpts.chunkOffset || 0);
  }

  function concatStemBuffers(parts) {
    if (!parts.length) return parts[0];
    if (parts.length === 1) return parts[0];
    var total = 0;
    var sr = parts[0].melody.sampleRate;
    var i;
    parts.forEach(function (p) {
      total += p.melody.length;
    });
    function joinStem(key) {
      var out;
      if (state.audioCtx) out = state.audioCtx.createBuffer(2, total, sr);
      else out = new OfflineAudioContext(2, 1, sr).createBuffer(2, total, sr);
      var pos = 0;
      for (i = 0; i < parts.length; i++) {
        var buf = parts[i][key];
        out.getChannelData(0).set(buf.getChannelData(0), pos);
        out.getChannelData(1).set(buf.getChannelData(1), pos);
        pos += buf.length;
      }
      return out;
    }
    return {
      melody: joinStem("melody"),
      colors: joinStem("colors"),
      spells: joinStem("spells"),
    };
  }

  function sectionMul(section, layer) {
    var m = { pad: 1, arp: 1, mel: 1, beat: 1, skip: 0 };
    if (section === "intro") {
      m.pad = 0.45;
      m.arp = 0.35;
      m.mel = 0.55;
      m.beat = 0.4;
      m.skip = 1;
    } else if (section === "verse") {
      m.pad = 0.82;
      m.arp = 0.88;
      m.mel = 0.9;
      m.beat = 0.78;
    } else if (section === "hook") {
      m.pad = 1.05;
      m.arp = 1.12;
      m.mel = 1.4;
      m.beat = 1.28;
    } else if (section === "chorus") {
      m.pad = 1.28;
      m.arp = 1.22;
      m.mel = 1.55;
      m.beat = 1.48;
    } else if (section === "bridge") {
      m.pad = 0.72;
      m.arp = 1.05;
      m.mel = 0.82;
      m.beat = 0.68;
      m.skip = 1;
    } else if (section === "outro") {
      m.pad = 0.9;
      m.arp = 0.75;
      m.mel = 0.7;
      m.beat = 1.45;
    }
    if (layer === "arp" && m.skip) m.arp *= 0.72;
    return m;
  }

  function barTime(comp, bar, beat, fraction) {
    beat = beat == null ? 0 : beat;
    fraction = fraction == null ? 0 : fraction;
    return bar * comp.barDur + beat * comp.beatDur + fraction * comp.beatDur;
  }

  function spellSeed(spell, index) {
    var n = spell.paintingNum || 1;
    var mood = state.promptMood || analyzeListeningPrompt(getEarsPrompt());
    var p = 0;
    var src = mood.text + mood.archetypes.join("");
    for (var i = 0; i < src.length; i++) p += src.charCodeAt(i);
    return n * 7919 + index * 104729 + p * 13 + Math.floor(mood.tempo * 1000);
  }

  function resolveArchetype(spell) {
    var blob = tagBlob(spell);
    if (/water|river|ocean|rain|wave|tide/.test(blob)) return "water";
    if (/fire|flame|ember|ash|warm/.test(blob)) return "fire";
    if (/crystal|glass|silver|bell|lantern|light|gold|bright/.test(blob)) return "crystal";
    if (/wind|air|sky|mist|fog|cloud/.test(blob)) return "wind";
    if (/stone|wood|earth|marble|clay|bronze|copper|metal/.test(blob)) return "earth";
    if (/garden|forest|leaf|meadow|vine|petal|bloom|tree/.test(blob)) return "garden";
    if (/dark|void|deep|shadow|night/.test(blob)) return "void";
    if (/calm|soft|still|dream|tender/.test(blob)) return "choir";
    if (/brush|ink|grain|charcoal|paper|texture/.test(blob)) return "ink";
    if (/dance|rhythm|pulse|motion|beat/.test(blob)) return "pulse";
    var n = spell.paintingNum || 1;
    var fallback = ["garden", "ink", "wind", "crystal", "pulse"];
    return fallback[n % fallback.length];
  }

  function imagineSpellProfile(spell, index, total) {
    var a = spell.analysis || {};
    var n = spell.paintingNum || 1;
    var archetype = resolveArchetype(spell);
    var rootHz = 55 + (n % 28) * 11 + index * 5;

    return {
      title: spell.title || "Spell",
      num: n,
      archetype: archetype,
      rootHz: rootHz,
      gain: 0.55 / Math.sqrt(Math.max(1, total)),
      startAt: index * 0.55,
      timbre: ARCHETYPE_LABELS[archetype] || "textured spell body",
      mood: a.mood || "",
      color: spellAccentColor(spell, index),
      seed: spellSeed(spell, index),
    };
  }

  function renderImagine() {
    var el = $("ea-imagine");
    if (!el) return;
    var mood = analyzeListeningPrompt(getEarsPrompt());
    var parts = [];

    if (mood.text) {
      var key = promptToKey(mood, state.applied);
      parts.push(
        "<strong>Your scene</strong> — “" +
          escapeHtml(mood.text) +
          "”"
      );
      if (mood.wordSceneMap && mood.wordSceneMap.length) {
        var wordScenes = mood.wordSceneMap
          .slice(0, 6)
          .map(function (e) {
            return (
              "“" +
              escapeHtml(e.word) +
              "”→" +
              escapeHtml(SFX_LABELS[e.type] || e.type)
            );
          })
          .join(" · ");
        parts.push("<strong>Scene layers</strong> — your words drive sounds: " + wordScenes);
      } else if (mood.sfx.length) {
        var sfxNames = mood.sfx
          .slice(0, 6)
          .map(function (s) {
            return SFX_LABELS[s.type] || s.type;
          })
          .join(", ");
        parts.push("<strong>Scene layers</strong> — " + escapeHtml(sfxNames));
      }
      var scaleLabel =
        key.ratios === SCALE_MINOR ? "minor" : key.ratios === SCALE_MAJOR ? "major" : "pentatonic";
      parts.push(
        "<strong>From your words</strong> — " +
          escapeHtml(mood.words.slice(0, 8).join(" · ") || mood.text.slice(0, 60)) +
          " → " +
          scaleLabel +
          " · " +
          escapeHtml(ARCHETYPE_LABELS[mood.primaryArchetype] || mood.primaryArchetype) +
          " · key ~" +
          Math.round(key.root) +
          "Hz · ~3:00"
      );
    }

    if (!state.applied.length) {
      parts.push("Drag spells onto the stage — spells and prompt blend together when you generate.");
      el.innerHTML = parts.join("<br>");
      renderHarmonyReference();
      return;
    }

    state.applied.forEach(function (spell, i) {
      var p = imagineSpellProfile(spell, i, state.applied.length);
      parts.push(
        "<strong>#" +
          p.num +
          " " +
          escapeHtml(p.title) +
          "</strong> — " +
          escapeHtml(p.timbre) +
          (p.mood ? " · " + escapeHtml(p.mood) : "")
      );
    });
    el.innerHTML = parts.join("<br>");
    renderHarmonyReference();
  }

  function getEarsPrompt() {
    var el = $("ea-input");
    return el && el.value ? el.value.trim() : "";
  }

  function readSlider(id, fallback) {
    var el = $(id);
    if (!el) return fallback;
    var v = parseFloat(el.value);
    return isNaN(v) ? fallback : v;
  }

  function getTweaks() {
    return {
      volume: readSlider("ea-volume", 100) / 100,
      clarity: readSlider("ea-clarity", 80) / 100,
      melody: readSlider("ea-melody", 100) / 100,
      colors: readSlider("ea-colors", 100) / 100,
      spells: readSlider("ea-spells-mix", 100) / 100,
      space: readSlider("ea-space", 40) / 100,
      tempo: readSlider("ea-tempo", 100) / 100,
      density: readSlider("ea-density", 100) / 100,
    };
  }

  function getEffectiveMood(analyzed) {
    var tweaks = getTweaks();
    var mood = {};
    var k;
    for (k in analyzed) {
      if (Object.prototype.hasOwnProperty.call(analyzed, k)) mood[k] = analyzed[k];
    }
    mood.density = (analyzed.density || 1) * tweaks.density;
    mood.space = tweaks.space;
    mood.clarity = tweaks.clarity;
    return mood;
  }

  function getBakeMood(analyzed, spells) {
    var tweaks = getTweaks();
    var mood = {};
    var k;
    for (k in analyzed) {
      if (Object.prototype.hasOwnProperty.call(analyzed, k)) mood[k] = analyzed[k];
    }
    mood.density = (analyzed.density || 1) * tweaks.density;
    mood.clarity = tweaks.clarity;
    mood.spellSig = spellsSignature(spells);
    mood.spellCount = (spells || []).length;
    return mood;
  }

  function playbackDetuneForRate(rate) {
    rate = Math.max(0.01, Math.min(4, rate || 1));
    if (Math.abs(rate - 1) < 0.001) return 0;
    return -1200 * Math.log2(rate);
  }

  function setSourcePlaybackSpeed(src, rate) {
    if (!src) return;
    rate = Math.max(0.01, Math.min(4, rate || 1));
    if (src.playbackRate) src.playbackRate.value = rate;
    if (src.detune) src.detune.value = playbackDetuneForRate(rate);
  }

  function updateMixLabels() {
    MIX_CONTROLS.forEach(function (cfg) {
      var el = $(cfg.id);
      var valEl = $(cfg.valId);
      if (!el || !valEl) return;
      valEl.textContent = cfg.fmt(readSlider(cfg.id, parseFloat(el.getAttribute("value") || "0")));
    });
    updateKnobDials();
    renderHarmonyReference();
  }

  function updateKnobDials() {
    document.querySelectorAll(".ea-knob-wrap[data-knob-for]").forEach(function (wrap) {
      var inputId = wrap.getAttribute("data-knob-for");
      var input = $(inputId);
      var knob = wrap.querySelector(".ea-knob");
      var dial = knob && knob.querySelector(".ea-knob-dial");
      if (!input || !knob) return;
      var min = parseFloat(input.min);
      var max = parseFloat(input.max);
      var v = parseFloat(input.value);
      var pct = (v - min) / Math.max(0.001, max - min);
      var deg = -135 + pct * 270;
      knob.style.setProperty("--ea-knob-deg", deg + "deg");
      if (dial) dial.style.transform = "rotate(" + deg + "deg)";
    });
  }

  function bindMixerKnobs() {
    document.querySelectorAll(".ea-knob-wrap[data-knob-for]").forEach(function (wrap) {
      var inputId = wrap.getAttribute("data-knob-for");
      var input = $(inputId);
      var knob = wrap.querySelector(".ea-knob");
      if (!input || !knob) return;
      var isStructure = input.classList.contains("ea-mix-structure");

      function setKnobFromInput() {
        var min = parseFloat(input.min);
        var max = parseFloat(input.max);
        var v = parseFloat(input.value);
        var pct = (v - min) / Math.max(0.001, max - min);
        var deg = -135 + pct * 270;
        knob.style.setProperty("--ea-knob-deg", deg + "deg");
        var dial = knob.querySelector(".ea-knob-dial");
        if (dial) dial.style.transform = "rotate(" + deg + "deg)";
        updateMixLabels();
      }

      setKnobFromInput();

      knob.addEventListener("pointerdown", function (e) {
        knob.setPointerCapture(e.pointerId);
        var startY = e.clientY;
        var startV = parseFloat(input.value);
        var min = parseFloat(input.min);
        var max = parseFloat(input.max);
        var range = max - min;

        function onMove(ev) {
          var dy = startY - ev.clientY;
          input.value = String(Math.round(Math.max(min, Math.min(max, startV + dy * (range / 140)))));
          setKnobFromInput();
          if (isStructure) markStructureDirty();
          else applyLiveMix();
        }

        function onUp(ev) {
          knob.removeEventListener("pointermove", onMove);
          knob.removeEventListener("pointerup", onUp);
          knob.removeEventListener("pointercancel", onUp);
          try {
            knob.releasePointerCapture(ev.pointerId);
          } catch (err) {}
        }

        knob.addEventListener("pointermove", onMove);
        knob.addEventListener("pointerup", onUp);
        knob.addEventListener("pointercancel", onUp);
        e.preventDefault();
      });

      input.addEventListener("input", setKnobFromInput);
    });
  }

  function applyMasterVolume() {
    applyLiveMix();
  }

  function updateRemixButton() {
    var btn = $("ea-remix-btn");
    if (!btn) return;
    btn.disabled = !state.applied.length || state.generating;
    btn.textContent = state.structureDirty ? "Regenerate sound *" : "Regenerate sound";
  }

  function markStructureDirty() {
    if (!state.stems || state.generating) return;
    state.structureDirty = true;
    state.remixPending = true;
    updateRemixButton();
    setStatus("Density changed — hit Regenerate sound to rebuild the composition.", "ok");
  }

  function buildMixNodes() {
    if (state.mixNodes || !state.audioCtx) return;
    var ctx = state.audioCtx;
    var mn = {};
    mn.stemMelody = ctx.createGain();
    mn.stemColors = ctx.createGain();
    mn.stemSpells = ctx.createGain();
    mn.stemBus = ctx.createGain();
    mn.stemBus.gain.value = 0.92;

    mn.highPass = ctx.createBiquadFilter();
    mn.highPass.type = "highpass";
    mn.highPass.frequency.value = 160;
    mn.highPass.Q.value = 0.55;

    mn.lowShelf = ctx.createBiquadFilter();
    mn.lowShelf.type = "lowshelf";
    mn.lowShelf.frequency.value = 220;
    mn.lowShelf.gain.value = -1.5;

    mn.masterLp = ctx.createBiquadFilter();
    mn.masterLp.type = "lowpass";
    mn.masterLp.frequency.value = 10000;

    mn.highShelf = ctx.createBiquadFilter();
    mn.highShelf.type = "highshelf";
    mn.highShelf.frequency.value = 2600;
    mn.highShelf.gain.value = 5.5;

    mn.presence = ctx.createBiquadFilter();
    mn.presence.type = "peaking";
    mn.presence.frequency.value = 3200;
    mn.presence.Q.value = 0.9;
    mn.presence.gain.value = 4.5;

    mn.compressor = ctx.createDynamicsCompressor();
    mn.compressor.threshold.value = -20;
    mn.compressor.ratio.value = 2.0;
    mn.compressor.knee.value = 12;
    mn.compressor.attack.value = 0.008;
    mn.compressor.release.value = 0.18;

    mn.delay = ctx.createDelay(3.0);
    mn.delayIn = ctx.createGain();
    mn.delayFb = ctx.createGain();
    mn.delayLp = ctx.createBiquadFilter();
    mn.delayLp.type = "lowpass";
    mn.reverbReturn = ctx.createGain();
    mn.makeup = ctx.createGain();
    mn.makeup.gain.value = 1.12;

    mn.stemMelody.connect(mn.stemBus);
    mn.stemColors.connect(mn.stemBus);
    mn.stemSpells.connect(mn.stemBus);
    mn.stemBus.connect(mn.highPass);
    mn.highPass.connect(mn.lowShelf);
    mn.lowShelf.connect(mn.masterLp);
    mn.masterLp.connect(mn.highShelf);
    mn.highShelf.connect(mn.presence);
    mn.presence.connect(mn.compressor);
    mn.presence.connect(mn.delayIn);
    mn.delayIn.connect(mn.delay);
    mn.delay.connect(mn.delayFb);
    mn.delayFb.connect(mn.delay);
    mn.delay.connect(mn.delayLp);
    mn.delayLp.connect(mn.reverbReturn);
    mn.compressor.connect(mn.makeup);
    mn.reverbReturn.connect(mn.makeup);
    mn.makeup.connect(state.analyser);

    state.mixNodes = mn;
    applyLiveMix();
  }

  function applyLiveMix() {
    var t = getTweaks();
    if (state.masterGain) state.masterGain.gain.value = t.volume;
    if (!state.mixNodes) return;
    var mn = state.mixNodes;
    mn.stemMelody.gain.value = Math.max(0, t.melody);
    mn.stemColors.gain.value = Math.max(0, t.colors);
    mn.stemSpells.gain.value = Math.max(0, t.spells);
    mn.masterLp.frequency.value = 7600 + t.clarity * 4800;
    mn.highShelf.gain.value = t.clarity * 6;
    mn.presence.gain.value = t.clarity * 3.2;
    mn.makeup.gain.value = 1.02 + t.clarity * 0.16;
    var wet = t.space * (1.05 - t.clarity * 0.55);
    mn.delay.delayTime.value = 0.22 + t.space * 0.38;
    mn.delayFb.gain.value = 0.1 + wet * 0.2;
    mn.delayIn.gain.value = 0.12 + wet * 0.28;
    mn.delayLp.frequency.value = 3800 + t.clarity * 1200;
    mn.reverbReturn.gain.value = 0.08 + wet * 0.32;
    state.playbackRate = t.tempo;
    state.sources.forEach(function (src) {
      setSourcePlaybackSpeed(src, t.tempo);
    });
  }

  function resumeAudioContext() {
    if (!state.audioCtx) return Promise.resolve();
    if (state.audioCtx.state === "running") return Promise.resolve();
    return state.audioCtx.resume().then(function () {
      if (state.audioCtx.state !== "running") {
        throw new Error("Browser blocked audio — click Play or Generate again.");
      }
    });
  }

  function startAudioKeepWarm() {
    stopAudioKeepWarm();
    if (!state.audioCtx) return;
    var ctx = state.audioCtx;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    g.gain.value = 0.00001;
    osc.frequency.value = 440;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    state.audioKeepWarm = { osc: osc, g: g };
    resumeAudioContext().catch(function () {});
  }

  function stopAudioKeepWarm() {
    var warm = state.audioKeepWarm;
    if (!warm) return;
    try {
      warm.osc.stop();
    } catch (e) {}
    try {
      warm.osc.disconnect();
      warm.g.disconnect();
    } catch (e2) {}
    state.audioKeepWarm = null;
  }

  function vocalTuneProfile(mood, key, spells) {
    var arch = (mood && mood.primaryArchetype) || "choir";
    var tone = spellTimbre(arch);
    spells = spells || [];
    return {
      key: key,
      snapStrength: 0.5 + ((mood && mood.clarity) || 0.5) * 0.42,
      dryMix: Math.max(0.08, 0.28 - ((mood && mood.clarity) || 0.5) * 0.14),
      wetMix: 0.38 + ((mood && mood.clarity) || 0.5) * 0.38,
      glideSec: 0.028 + 0.04 / Math.max(0.55, (mood && mood.tempo) || 1),
      filterHz: tone.filterHz || 3000,
      filterQ: arch === "crystal" || arch === "fire" ? 1.4 : 0.75,
      detuneCents: (tone.detune || 0) * 0.45,
      vibratoDepth: arch === "water" || arch === "wind" ? 10 : arch === "pulse" ? 4 : 6,
      spaceWet: ((mood && mood.space) || 0.4) * 0.55,
      octaveBias: Math.min(2, Math.floor(spells.length / 3)),
      wave: tone.wave || "sine",
    };
  }

  function scaleFreqCandidates(key, minHz, maxHz) {
    var out = [];
    var oct;
    var deg;
    var f;
    for (oct = 2; oct <= 7; oct++) {
      for (deg = 0; deg < key.ratios.length; deg++) {
        f = degreeFreq(key, deg) * oct;
        if (f >= minHz && f <= maxHz) out.push(f);
      }
    }
    return out.sort(function (a, b) {
      return a - b;
    });
  }

  function nearestScaleFreq(hz, key, octaveBias) {
    if (!hz || hz < 70 || !key) return 0;
    var minHz = 120;
    var maxHz = 1400;
    var list = scaleFreqCandidates(key, minHz, maxHz);
    if (!list.length) return hz;
    var biasMul = Math.pow(2, (octaveBias || 0) * 0.35);
    var target = hz * biasMul;
    var best = list[0];
    var bestDist = Math.abs(Math.log2(target / best));
    var i;
    for (i = 1; i < list.length; i++) {
      var dist = Math.abs(Math.log2(target / list[i]));
      if (dist < bestDist) {
        bestDist = dist;
        best = list[i];
      }
    }
    return best / biasMul;
  }

  function detectMicPitchHz(analyser, sampleRate) {
    var buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    var size = buf.length;
    var rms = 0;
    var i;
    var r1 = 0;
    var r2 = size - 1;
    var trimmed;
    var c;
    var d = 0;
    var maxval;
    var maxpos;
    var T0;
    for (i = 0; i < size; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / size);
    if (rms < 0.006) return { hz: 0, rms: rms };
    for (i = 0; i < size / 2; i++) {
      if (Math.abs(buf[i]) < 0.018) {
        r1 = i;
        break;
      }
    }
    for (i = 1; i < size / 2; i++) {
      if (Math.abs(buf[size - i]) < 0.018) {
        r2 = size - i;
        break;
      }
    }
    trimmed = buf.subarray(r1, r2);
    size = trimmed.length;
    if (size < 64) return { hz: 0, rms: rms };
    c = new Float32Array(size);
    for (i = 0; i < size; i++) {
      var j;
      for (j = 0; j < size - i; j++) c[i] += trimmed[j] * trimmed[j + i];
    }
    while (d + 1 < size && c[d] > c[d + 1]) d++;
    maxval = -1;
    maxpos = -1;
    for (i = d; i < size; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }
    if (maxpos < 2) return { hz: 0, rms: rms };
    T0 = maxpos;
    return { hz: sampleRate / T0, rms: rms };
  }

  function formatVocalOctaveLabel(shift) {
    shift = shift || 0;
    if (Math.abs(shift) < 0.01) return "0";
    if (shift > 0) return "+" + shift;
    return String(shift);
  }

  function getVocalOctaveShift() {
    var el = $("ea-vocal-octave");
    if (!el) return state.vocal.octaveShift || 0;
    return parseFloat(el.value) || 0;
  }

  function getVocalOctaveMul() {
    return Math.pow(2, getVocalOctaveShift());
  }

  function getVocalMonitorLevel() {
    return readSlider("ea-vocal-level", 175) / 100;
  }

  function updateVocalLevelLabel() {
    var val = $("ea-vocal-level-val");
    if (val) val.textContent = Math.round(getVocalMonitorLevel() * 100) + "%";
  }

  function loadSavedVocalLevel() {
    try {
      var saved = parseFloat(localStorage.getItem(VOCAL_LEVEL_KEY));
      if (!isFinite(saved)) return;
      saved = Math.max(80, Math.min(250, saved));
      var el = $("ea-vocal-level");
      if (el) el.value = String(saved);
      updateVocalLevelLabel();
    } catch (eLvl) {}
  }

  function saveVocalMonitorLevel() {
    var level = Math.round(getVocalMonitorLevel() * 100);
    try {
      localStorage.setItem(VOCAL_LEVEL_KEY, String(level));
    } catch (eSave) {}
    updateVocalLevelLabel();
  }

  function applyVocalMonitorGain() {
    var vn = state.vocal.nodes;
    if (!vn || !vn.monitorGain) return;
    var level = getVocalMonitorLevel();
    if (state.vocal.liveOn) vn.monitorGain.gain.value = level * 1.35;
    else vn.monitorGain.gain.value = level;
    saveVocalMonitorLevel();
  }

  function applyVocalLiveBackingMix(on) {
    if (!state.masterGain || !state.audioCtx) return;
    var vol = Math.max(0.05, getTweaks().volume || 1);
    var now = state.audioCtx.currentTime;
    state.masterGain.gain.cancelScheduledValues(now);
    state.masterGain.gain.setTargetAtTime(on ? vol * VOCAL_LIVE_BACKING_MUL : vol, now, 0.1);
  }

  function loadSavedVocalOctave() {
    try {
      var saved = parseFloat(localStorage.getItem(VOCAL_OCTAVE_KEY));
      if (!isFinite(saved)) return;
      saved = Math.max(-2, Math.min(2, saved));
      state.vocal.octaveShift = saved;
      var el = $("ea-vocal-octave");
      var val = $("ea-vocal-octave-val");
      if (el) el.value = String(saved);
      if (val) val.textContent = formatVocalOctaveLabel(saved);
    } catch (eOct) {}
  }

  function saveVocalOctaveShift(shift) {
    state.vocal.octaveShift = shift;
    try {
      localStorage.setItem(VOCAL_OCTAVE_KEY, String(shift));
    } catch (eSave) {}
    var val = $("ea-vocal-octave-val");
    if (val) val.textContent = formatVocalOctaveLabel(shift);
  }

  function ensureVocalOctaveWorklet(ctx) {
    if (!ctx || !ctx.audioWorklet) return Promise.reject(new Error("AudioWorklet unavailable"));
    if (_vocalOctaveWorkletCtx === ctx && _vocalOctaveWorkletPromise) return _vocalOctaveWorkletPromise;
    _vocalOctaveWorkletCtx = ctx;
    var code =
      "class VocalOctaveShiftProcessor extends AudioWorkletProcessor {" +
      "constructor(){super();this.ratio=1;this.buf=new Float32Array(32768);this.w=0;this.r=0;this.primed=false;" +
      "this.port.onmessage=(e)=>{if(e.data&&typeof e.data.ratio==='number')this.ratio=Math.max(0.25,Math.min(4,e.data.ratio));};}" +
      "process(inputs,outputs){const input=inputs[0]&&inputs[0][0];const output=outputs[0]&&outputs[0][0];" +
      "if(!input||!output)return true;const buf=this.buf;const n=buf.length;const delay=2048;" +
      "for(let i=0;i<output.length;i++){buf[this.w%n]=input[i];" +
      "if(!this.primed&&this.w>delay*2){this.r=this.w-delay;this.primed=true;}this.w++;" +
      "if(!this.primed){output[i]=0;continue;}this.r+=this.ratio;" +
      "if(this.r>this.w-256)this.r=this.w-delay;const ri=Math.floor(this.r);const frac=this.r-ri;" +
      "const i0=ri%n;const i1=(i0+1)%n;output[i]=buf[i0]*(1-frac)+buf[i1]*frac;}return true;}}" +
      "registerProcessor('" +
      VOCAL_OCTAVE_WORKLET +
      "',VocalOctaveShiftProcessor);";
    var blob = new Blob([code], { type: "application/javascript" });
    var url = URL.createObjectURL(blob);
    _vocalOctaveWorkletPromise = ctx.audioWorklet.addModule(url).then(function () {
      URL.revokeObjectURL(url);
    }).catch(function (err) {
      _vocalOctaveWorkletPromise = null;
      _vocalOctaveWorkletCtx = null;
      URL.revokeObjectURL(url);
      throw err;
    });
    return _vocalOctaveWorkletPromise;
  }

  function connectDryThroughOctaveShifter(vn) {
    if (!vn || !vn.presence || !vn.dryGain) return;
    try {
      vn.presence.disconnect();
    } catch (e1) {}
    try {
      if (vn.pitchShift) vn.pitchShift.disconnect();
    } catch (e2) {}
    try {
      vn.dryGain.disconnect();
    } catch (e3) {}
    var mul = getVocalOctaveMul();
    if (vn.pitchShift && Math.abs(mul - 1) > 0.001) {
      vn.presence.connect(vn.pitchShift);
      vn.pitchShift.connect(vn.dryGain);
      vn.pitchShift.port.postMessage({ ratio: mul });
    } else {
      vn.presence.connect(vn.dryGain);
      if (vn.pitchShift) vn.pitchShift.port.postMessage({ ratio: 1 });
    }
    vn.dryGain.connect(vn.dryToOut);
  }

  function attachVocalOctaveShifter() {
    var vn = state.vocal.nodes;
    if (!vn || !state.audioCtx) return Promise.resolve();
    if (vn.pitchShift) {
      connectDryThroughOctaveShifter(vn);
      return Promise.resolve();
    }
    return ensureVocalOctaveWorklet(state.audioCtx)
      .then(function () {
        if (!state.vocal.nodes) return;
        vn = state.vocal.nodes;
        if (vn.pitchShift) {
          connectDryThroughOctaveShifter(vn);
          return;
        }
        vn.pitchShift = new AudioWorkletNode(state.audioCtx, VOCAL_OCTAVE_WORKLET, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
        });
        connectDryThroughOctaveShifter(vn);
      })
      .catch(function () {
        connectDryThroughOctaveShifter(vn);
      });
  }

  function applyVocalOctaveShift() {
    saveVocalOctaveShift(getVocalOctaveShift());
    var vn = state.vocal.nodes;
    if (!vn) return;
    connectDryThroughOctaveShifter(vn);
  }

  function chordFreqsNearRoot(rootHz, key) {
    if (!rootHz || rootHz < 70 || !key) return null;
    var candidates = scaleFreqCandidates(key, 90, 1800);
    if (!candidates.length) {
      return { root: rootHz, third: rootHz * 1.26, fifth: rootHz * 1.5 };
    }
    var bestI = 0;
    var bestD = Infinity;
    var i;
    for (i = 0; i < candidates.length; i++) {
      var dist = Math.abs(Math.log2(rootHz / candidates[i]));
      if (dist < bestD) {
        bestD = dist;
        bestI = i;
      }
    }
    return {
      root: candidates[bestI],
      third: candidates[Math.min(candidates.length - 1, bestI + 2)],
      fifth: candidates[Math.min(candidates.length - 1, bestI + 4)],
    };
  }

  function makeChordDriveCurve(drive) {
    var n = 256;
    var curve = new Float32Array(n);
    var k = Math.max(1, drive || 1.55);
    var i;
    var x;
    for (i = 0; i < n; i++) {
      x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.sign(x) * (1 - Math.exp(-Math.abs(x) * k)) * 0.82;
    }
    return curve;
  }

  function makeVintageDriveCurve(drive) {
    var n = 256;
    var curve = new Float32Array(n);
    var k = Math.max(0.65, drive || 1.1);
    var i;
    var x;
    var y;
    var denom = Math.tanh(k);
    for (i = 0; i < n; i++) {
      x = (i * 2) / (n - 1) - 1;
      y = Math.tanh(x * k) / denom;
      curve[i] = y * 0.72 + x * 0.28;
    }
    return curve;
  }

  function applyVintageDeviceTone() {
    var vn = state.vocal.nodes;
    if (!vn || !vn.vintageHigh) return;
    var live = !!state.vocal.liveOn;
    vn.vintageHigh.frequency.value = live ? 118 : 125;
    vn.vintageHigh.Q.value = 0.42;
    if (vn.vintageWarm) {
      vn.vintageWarm.frequency.value = 320;
      vn.vintageWarm.gain.value = live ? 2.6 : 2.2;
    }
    vn.vintageMid.frequency.value = 920;
    vn.vintageMid.gain.value = live ? 1.2 : 0.9;
    vn.vintageMid.Q.value = 0.52;
    vn.vintageLow.frequency.value = live ? 5200 : 5600;
    vn.vintageLow.Q.value = 0.48;
    vn.vintageDrive.curve = makeVintageDriveCurve(live ? 1.12 : 1.05);
    vn.vintageDrive.oversample = "2x";
    vn.vintageComp.threshold.value = live ? -22 : -24;
    vn.vintageComp.ratio.value = 2;
    vn.vintageComp.knee.value = 14;
    vn.vintageComp.attack.value = 0.02;
    vn.vintageComp.release.value = 0.24;
    vn.tapeSend.gain.value = live ? 0.028 : 0.022;
    vn.tapeReturn.gain.value = live ? 0.032 : 0.026;
    vn.tapeDelay.delayTime.value = 0.082;
    vn.tapeFb.gain.value = 0.07;
  }

  function buildVocalNodes() {
    if (state.vocal.nodes || !state.audioCtx) return;
    var ctx = state.audioCtx;
    var vn = {};
    vn.input = ctx.createGain();
    vn.input.gain.value = 1;
    vn.highPass = ctx.createBiquadFilter();
    vn.highPass.type = "highpass";
    vn.highPass.frequency.value = 80;
    vn.highPass.Q.value = 0.55;
    vn.compressor = ctx.createDynamicsCompressor();
    vn.compressor.threshold.value = -24;
    vn.compressor.ratio.value = 2.6;
    vn.compressor.knee.value = 10;
    vn.compressor.attack.value = 0.006;
    vn.compressor.release.value = 0.12;
    vn.pitchAnalyser = ctx.createAnalyser();
    vn.pitchAnalyser.fftSize = 2048;
    vn.pitchAnalyser.smoothingTimeConstant = 0.35;
    vn.presence = ctx.createBiquadFilter();
    vn.presence.type = "peaking";
    vn.presence.frequency.value = 3200;
    vn.presence.Q.value = 0.9;
    vn.presence.gain.value = 0;
    vn.dryGain = ctx.createGain();
    vn.tuneGain = ctx.createGain();
    vn.tuneOscA = ctx.createOscillator();
    vn.tuneOscB = ctx.createOscillator();
    vn.tuneOscA.type = "sine";
    vn.tuneOscB.type = "triangle";
    vn.tuneOscA.frequency.value = 220;
    vn.tuneOscB.frequency.value = 220;
    vn.tuneOscA.detune.value = 0;
    vn.tuneOscB.detune.value = -4;
    vn.tuneOscA.start();
    vn.tuneOscB.start();
    vn.formant = ctx.createBiquadFilter();
    vn.formant.type = "peaking";
    vn.formant.frequency.value = 2800;
    vn.formant.Q.value = 0.8;
    vn.formant.gain.value = 2.5;
    vn.chordOscRoot = ctx.createOscillator();
    vn.chordOscThird = ctx.createOscillator();
    vn.chordOscFifth = ctx.createOscillator();
    vn.chordOscRoot.type = "sine";
    vn.chordOscThird.type = "triangle";
    vn.chordOscFifth.type = "sawtooth";
    vn.chordOscRoot.frequency.value = 220;
    vn.chordOscThird.frequency.value = 277;
    vn.chordOscFifth.frequency.value = 330;
    vn.chordOscRoot.start();
    vn.chordOscThird.start();
    vn.chordOscFifth.start();
    vn.chordRootLvl = ctx.createGain();
    vn.chordThirdLvl = ctx.createGain();
    vn.chordFifthLvl = ctx.createGain();
    vn.chordRootLvl.gain.value = 0.22;
    vn.chordThirdLvl.gain.value = 0.42;
    vn.chordFifthLvl.gain.value = 0.36;
    vn.chordPre = ctx.createGain();
    vn.chordDrive = ctx.createWaveShaper();
    vn.chordDrive.curve = makeChordDriveCurve(1.55);
    vn.chordDrive.oversample = "2x";
    vn.chordGain = ctx.createGain();
    vn.chordGain.gain.value = 0;
    vn.effectTone = ctx.createBiquadFilter();
    vn.effectTone.type = "peaking";
    vn.effectTone.frequency.value = 980;
    vn.effectTone.Q.value = 0.7;
    vn.effectTone.gain.value = 1.8;
    vn.dryToOut = ctx.createGain();
    vn.effectToOut = ctx.createGain();
    vn.dryToOut.gain.value = 1;
    vn.effectToOut.gain.value = 0.4;
    vn.sum = ctx.createGain();
    vn.vintageHigh = ctx.createBiquadFilter();
    vn.vintageHigh.type = "highpass";
    vn.vintageHigh.frequency.value = 120;
    vn.vintageHigh.Q.value = 0.42;
    vn.vintageWarm = ctx.createBiquadFilter();
    vn.vintageWarm.type = "lowshelf";
    vn.vintageWarm.frequency.value = 320;
    vn.vintageWarm.gain.value = 2.4;
    vn.vintageMid = ctx.createBiquadFilter();
    vn.vintageMid.type = "peaking";
    vn.vintageMid.frequency.value = 920;
    vn.vintageMid.Q.value = 0.52;
    vn.vintageMid.gain.value = 1.1;
    vn.vintageLow = ctx.createBiquadFilter();
    vn.vintageLow.type = "lowpass";
    vn.vintageLow.frequency.value = 5200;
    vn.vintageLow.Q.value = 0.48;
    vn.vintageMix = ctx.createGain();
    vn.tapeSend = ctx.createGain();
    vn.tapeDelay = ctx.createDelay(0.12);
    vn.tapeFb = ctx.createGain();
    vn.tapeReturn = ctx.createGain();
    vn.vintageDrive = ctx.createWaveShaper();
    vn.vintageDrive.curve = makeVintageDriveCurve(1.1);
    vn.vintageDrive.oversample = "2x";
    vn.vintageComp = ctx.createDynamicsCompressor();
    vn.vintageComp.threshold.value = -22;
    vn.vintageComp.ratio.value = 2;
    vn.vintageComp.knee.value = 14;
    vn.vintageComp.attack.value = 0.02;
    vn.vintageComp.release.value = 0.24;
    vn.spaceSend = ctx.createGain();
    vn.spaceDelay = ctx.createDelay(1.2);
    vn.spaceFb = ctx.createGain();
    vn.spaceReturn = ctx.createGain();
    vn.out = ctx.createGain();
    vn.monitorGain = ctx.createGain();
    vn.monitorGain.gain.value = 1;
    try {
      vn.recordDest = ctx.createMediaStreamDestination();
    } catch (eRec) {
      vn.recordDest = null;
    }

    vn.input.connect(vn.highPass);
    vn.highPass.connect(vn.compressor);
    vn.compressor.connect(vn.pitchAnalyser);
    vn.compressor.connect(vn.presence);
    vn.presence.connect(vn.dryGain);
    vn.tuneOscA.connect(vn.tuneGain);
    vn.tuneOscB.connect(vn.tuneGain);
    vn.tuneGain.connect(vn.formant);
    vn.chordOscRoot.connect(vn.chordRootLvl);
    vn.chordOscThird.connect(vn.chordThirdLvl);
    vn.chordOscFifth.connect(vn.chordFifthLvl);
    vn.chordRootLvl.connect(vn.chordPre);
    vn.chordThirdLvl.connect(vn.chordPre);
    vn.chordFifthLvl.connect(vn.chordPre);
    vn.formant.connect(vn.chordPre);
    vn.chordPre.connect(vn.chordDrive);
    vn.chordDrive.connect(vn.chordGain);
    vn.chordGain.connect(vn.effectTone);
    vn.effectTone.connect(vn.effectToOut);
    vn.effectToOut.connect(vn.out);
    vn.dryGain.connect(vn.dryToOut);
    vn.dryToOut.connect(vn.out);
    vn.out.connect(vn.monitorGain);
    vn.out.connect(vn.spaceSend);
    vn.spaceSend.connect(vn.spaceDelay);
    vn.spaceDelay.connect(vn.spaceFb);
    vn.spaceFb.connect(vn.spaceDelay);
    vn.spaceDelay.connect(vn.spaceReturn);
    vn.spaceReturn.connect(vn.chordPre);

    vn.dryGain.gain.value = 0.75;
    vn.tuneGain.gain.value = 0;
    vn.out.gain.value = 1;
    vn.spaceSend.gain.value = 0;
    vn.spaceReturn.gain.value = 0;
    vn.spaceDelay.delayTime.value = 0.18;
    vn.spaceFb.gain.value = 0.22;
    vn.tapeSend.gain.value = 0.028;
    vn.tapeReturn.gain.value = 0.032;
    vn.tapeFb.gain.value = 0.07;
    vn.tapeDelay.delayTime.value = 0.082;

    applyVintageDeviceTone();
    state.vocal.nodes = vn;
  }

  function refreshVocalProfile() {
    var mood = state.promptMood || getEffectiveMood(analyzeListeningPrompt(getEarsPrompt()));
    var key = promptToKey(mood, state.applied);
    state.vocal.profile = vocalTuneProfile(mood, key, state.applied);
    applyVocalMixProfile();
  }

  function applyVocalMixProfile() {
    var vn = state.vocal.nodes;
    var profile = state.vocal.profile;
    if (!vn || !profile) return;
    vn.formant.frequency.value = profile.filterHz;
    vn.formant.Q.value = profile.filterQ;
    vn.tuneOscA.detune.value = profile.detuneCents;
    vn.tuneOscB.detune.value = profile.detuneCents - 5;
    if (state.vocal.liveOn) {
      var octaveMul = getVocalOctaveMul();
      var octaveComp = octaveMul > 1 ? Math.min(1.35, Math.pow(octaveMul, 0.22)) : 1;
      vn.input.gain.value = 2.55;
      vn.presence.gain.value = 5.2;
      vn.dryGain.gain.value = 1.28 * octaveComp;
      vn.dryToOut.gain.value = 1.45;
      vn.effectToOut.gain.value = 0.28;
      vn.formant.gain.value = 1.8;
      vn.formant.Q.value = Math.max(profile.filterQ, 0.85);
      vn.chordDrive.curve = makeChordDriveCurve(1.48);
      vn.effectTone.frequency.value = 1020;
      vn.effectTone.gain.value = 1.6;
      vn.out.gain.value = 1.12;
      vn.spaceSend.gain.value = profile.spaceWet * 0.03;
      vn.spaceReturn.gain.value = profile.spaceWet * 0.035;
      vn.compressor.threshold.value = -16;
      vn.compressor.ratio.value = 1.9;
      applyVocalMonitorGain();
      return;
    }
    if (state.vocal.recording) {
      vn.input.gain.value = 1.25;
      vn.presence.gain.value = 1.4;
      vn.dryGain.gain.value = Math.max(0.22, profile.dryMix * 0.62);
      vn.out.gain.value = 0.95;
      vn.spaceSend.gain.value = profile.spaceWet * 0.12;
      vn.spaceReturn.gain.value = profile.spaceWet * 0.14;
      vn.compressor.threshold.value = -26;
      vn.compressor.ratio.value = 3;
      applyVintageDeviceTone();
      return;
    }
    vn.input.gain.value = 1;
    vn.presence.gain.value = 0;
    vn.dryGain.gain.value = profile.dryMix;
    vn.out.gain.value = 0.9;
    vn.spaceSend.gain.value = profile.spaceWet * 0.35;
    vn.spaceReturn.gain.value = profile.spaceWet * 0.42;
    vn.compressor.threshold.value = -24;
    vn.compressor.ratio.value = 2.6;
  }

  function connectVocalToSpeakers(on) {
    var vn = state.vocal.nodes;
    if (!vn || !state.analyser) return;
    var tap = vn.monitorGain || vn.out;
    try {
      tap.disconnect(state.analyser);
    } catch (e1) {}
    try {
      vn.out.disconnect(state.analyser);
    } catch (e2) {}
    if (on) tap.connect(state.analyser);
  }

  function connectVocalToRecorder(on) {
    var vn = state.vocal.nodes;
    if (!vn || !vn.recordDest) return;
    try {
      vn.out.disconnect(vn.recordDest);
    } catch (e1) {}
    if (on) vn.out.connect(vn.recordDest);
  }

  function stopVocalPitchLoop() {
    if (state.vocal.pitchTimer) {
      clearInterval(state.vocal.pitchTimer);
      state.vocal.pitchTimer = 0;
    }
    if (state.vocal.pitchRaf) {
      cancelAnimationFrame(state.vocal.pitchRaf);
      state.vocal.pitchRaf = 0;
    }
  }

  function startVocalPitchLoop() {
    stopVocalPitchLoop();
    var vn = state.vocal.nodes;
    if (!vn || !state.audioCtx) return;
    var ctx = state.audioCtx;
    var vibPhase = 0;
    state.vocal.pitchTimer = setInterval(function () {
      if (!state.vocal.mode) return;
      var profile = state.vocal.profile;
      if (!profile) return;
      var reading = detectMicPitchHz(vn.pitchAnalyser, ctx.sampleRate);
      var now = ctx.currentTime;
      var snapped;
      var glide;
      var env;
      if (reading.hz > 70) {
        var octaveMul = getVocalOctaveMul();
        snapped = nearestScaleFreq(reading.hz, profile.key, profile.octaveBias);
        var outHz = snapped * octaveMul;
        if (!state.vocal.currentHz) state.vocal.currentHz = outHz;
        glide = profile.glideSec;
        if (state.vocal.liveOn) glide *= 0.32;
        state.vocal.currentHz += (outHz - state.vocal.currentHz) * Math.min(1, (state.vocal.liveOn ? 0.14 : 0.035) / Math.max(0.008, glide));
        state.vocal.targetHz = outHz;
      }
      vibPhase += 0.14 + profile.vibratoDepth * 0.004;
      env = Math.min(1, reading.rms * 14) * profile.wetMix * profile.snapStrength;
      if (state.vocal.liveOn) env *= 0.22;
      vn.tuneGain.gain.setTargetAtTime(env, now, state.vocal.liveOn ? 0.012 : 0.02);
      if (state.vocal.liveOn) {
        var chordEnv = Math.min(0.42, reading.rms * 9) * profile.snapStrength * 0.38;
        vn.chordGain.gain.setTargetAtTime(chordEnv, now, 0.018);
      } else {
        vn.chordGain.gain.setTargetAtTime(env * 0.75, now, 0.02);
      }
      if (state.vocal.currentHz > 70) {
        var vib = Math.sin(vibPhase) * profile.vibratoDepth * (state.vocal.liveOn ? 0.08 : 0.12);
        var tuneGlide = state.vocal.liveOn ? profile.glideSec * 0.28 : profile.glideSec;
        vn.tuneOscA.frequency.setTargetAtTime(state.vocal.currentHz, now, tuneGlide);
        vn.tuneOscB.frequency.setTargetAtTime(state.vocal.currentHz * 1.002, now, tuneGlide);
        vn.tuneOscA.detune.setTargetAtTime(profile.detuneCents + vib, now, state.vocal.liveOn ? 0.02 : 0.04);
        var chords = chordFreqsNearRoot(state.vocal.currentHz, profile.key);
        if (chords && vn.chordOscRoot) {
          vn.chordOscRoot.frequency.setTargetAtTime(chords.root, now, tuneGlide);
          vn.chordOscThird.frequency.setTargetAtTime(chords.third, now, tuneGlide);
          vn.chordOscFifth.frequency.setTargetAtTime(chords.fifth, now, tuneGlide);
        }
      }
      if (state.vocal.recording && state.vocal.recordStarted && reading.hz > 70 && reading.rms > 0.008) {
        state.vocal.capturePoints.push({
          t: (state.vocal.recordTimelineOffset || 0) + (Date.now() - state.vocal.recordStarted) / 1000,
          freq: state.vocal.currentHz || reading.hz,
          peak: Math.min(0.22, reading.rms * 2.8),
        });
      }
    }, 28);
  }

  function vocalCaptureToScoreNotes(points) {
    if (!points || !points.length) return [];
    var notes = [];
    var segStart = points[0].t;
    var segFreq = points[0].freq;
    var segPeak = points[0].peak;
    var lastT = points[0].t;
    var i;
    var p;
    var gap;
    function flush(endT) {
      var dur = endT - segStart;
      if (segFreq > 60 && dur >= 0.06) {
        notes.push({
          stem: "vocal",
          t: segStart,
          freq: segFreq,
          dur: dur + 0.08,
          peak: Math.max(0.03, segPeak),
          wave: "sine",
          kind: "voice",
          harmonic: true,
          harmonicMix: 0.22,
          filterHz: 3200,
        });
      }
    }
    for (i = 1; i < points.length; i++) {
      p = points[i];
      gap = p.t - lastT;
      if (gap > 0.22 || Math.abs(Math.log2(p.freq / segFreq)) > 0.09) {
        flush(lastT);
        segStart = p.t;
        segFreq = p.freq;
        segPeak = p.peak;
      } else if (p.peak > segPeak) {
        segPeak = p.peak;
      }
      lastT = p.t;
    }
    flush(lastT);
    return notes;
  }

  function clampNoteToScoreDuration(note, duration) {
    if (!note || !duration) return note;
    note.t = Math.max(0, Math.min(note.t, duration - 0.04));
    note.dur = Math.max(0.04, Math.min(note.dur, duration - note.t));
    return note;
  }

  function appendVocalNotesToScore(notes) {
    if (!notes || !notes.length) return 0;
    var ed = ensureScoreEdit();
    var i;
    for (i = 0; i < notes.length; i++) {
      ed.notes.push(cloneScoreNote(clampNoteToScoreDuration(notes[i], ed.duration)));
    }
    ed.notes.sort(function (a, b) {
      return a.t - b.t;
    });
    state.liveScore = getScoreFromEditor();
    markScoreDirty();
    updateScoreToolbar();
    renderScoreRoll();
    return notes.length;
  }

  function syncScorePlaybackAfterVocal(wasPlaying, resumeAt) {
    stopVocalPlaybackSource();
    var score = getScoreFromEditor();
    if (!score || !score.notes.length) return Promise.resolve();
    state.liveScore = score;
    state.livePlayback = true;
    var head = resumeAt != null ? resumeAt : 0;
    head = Math.max(0, Math.min(head, score.duration - 0.02));
    state.playhead = head;
    updateTransport();
    updateScanline();
    if (!wasPlaying) return Promise.resolve();
    return playLiveScore(score, head);
  }

  function stopVocalMicStream() {
    if (state.vocal.stream) {
      state.vocal.stream.getTracks().forEach(function (t) {
        try {
          t.stop();
        } catch (e) {}
      });
      state.vocal.stream = null;
      state.vocal.streamLiveMode = null;
    }
    if (state.vocal.nodes && state.vocal.nodes.micSource) {
      try {
        state.vocal.nodes.micSource.disconnect();
      } catch (e2) {}
      state.vocal.nodes.micSource = null;
    }
  }

  function stopVocalPlaybackSource() {
    if (state.vocal.playbackSource) {
      try {
        state.vocal.playbackSource.stop();
      } catch (e) {}
      try {
        state.vocal.playbackSource.disconnect();
      } catch (e2) {}
      state.vocal.playbackSource = null;
    }
  }

  function updateVocalUi() {
    var liveBtn = $("ea-vocal-live-btn");
    var recBtn = $("ea-vocal-record-btn");
    var status = $("ea-vocal-status");
    if (liveBtn) {
      liveBtn.classList.toggle("ea-active", !!state.vocal.liveOn);
      liveBtn.textContent = state.vocal.liveOn ? "Live mic on" : "Live mic";
    }
    if (recBtn) {
      recBtn.classList.toggle("ea-active", !!state.vocal.recording);
      recBtn.textContent = state.vocal.recording ? "Stop & play take" : "Record vocal";
    }
    if (status) {
      if (state.vocal.recording) status.textContent = "Recording tuned vocal — no speaker feedback until you stop.";
      else if (state.vocal.liveOn) status.textContent = "Live mic — your voice up front; chord distortion sits nearby, keyed to prompt & spells.";
      else status.textContent = "";
    }
  }

  function stopVocal() {
    stopVocalPitchLoop();
    if (state.vocal.recorder && state.vocal.recording) {
      try {
        state.vocal.recorder.stop();
      } catch (e) {}
    }
    state.vocal.recording = false;
    state.vocal.liveOn = false;
    state.vocal.mode = null;
    state.vocal.recorder = null;
    state.vocal.chunks = [];
    connectVocalToSpeakers(false);
    connectVocalToRecorder(false);
    applyVocalLiveBackingMix(false);
    stopVocalMicStream();
    state.vocal.nodes = null;
    updateVocalUi();
  }

  function ensureMicStream(forLive) {
    var wantLive = !!forLive;
    if (state.vocal.stream && state.vocal.streamLiveMode === wantLive) {
      return Promise.resolve(state.vocal.stream);
    }
    stopVocalMicStream();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("Microphone not available in this browser."));
    }
    return navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: !wantLive,
          autoGainControl: true,
        },
        video: false,
      })
      .then(function (stream) {
        state.vocal.stream = stream;
        state.vocal.streamLiveMode = wantLive;
        return stream;
      });
  }

  function wireMicToVocalChain() {
    var vn = state.vocal.nodes;
    if (!vn || !state.vocal.stream) return;
    if (vn.micSource) {
      try {
        vn.micSource.disconnect();
      } catch (e) {}
    }
    vn.micSource = state.audioCtx.createMediaStreamSource(state.vocal.stream);
    vn.micSource.connect(vn.input);
  }

  function toggleVocalLive() {
    if (state.vocal.liveOn) {
      stopVocal();
      setStatus("Live mic off.", "ok");
      return Promise.resolve();
    }
    if (state.vocal.recording) stopVocal();
    return ensureAudioGraph()
      .then(function () {
        return resumeAudioContext();
      })
      .then(function () {
        buildVocalNodes();
        refreshVocalProfile();
        return ensureMicStream(true);
      })
      .then(function () {
        wireMicToVocalChain();
        return attachVocalOctaveShifter();
      })
      .then(function () {
        state.vocal.mode = "live";
        state.vocal.liveOn = true;
        state.vocal.currentHz = 0;
        state.vocal.targetHz = 0;
        applyVocalMixProfile();
        applyVocalOctaveShift();
        connectVocalToRecorder(false);
        connectVocalToSpeakers(true);
        applyVocalLiveBackingMix(true);
        startVocalPitchLoop();
        updateVocalUi();
        setStatus("Live mic on — raise Mic level if needed; Octave shifts your pitch.", "ok");
      })
      .catch(function (err) {
        stopVocal();
        setStatus(err.message || "Could not open microphone.", "error");
      });
  }

  function playVocalBlob(blob) {
    stopVocalPlaybackSource();
    return ensureAudioGraph().then(function () {
      return blob.arrayBuffer();
    }).then(function (ab) {
      return state.audioCtx.decodeAudioData(ab);
    }).then(function (buffer) {
      var src = state.audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(state.analyser);
      src.onended = function () {
        if (state.vocal.playbackSource === src) state.vocal.playbackSource = null;
        updateVocalUi();
      };
      state.vocal.playbackSource = src;
      src.start();
      setStatus("Playing your tuned vocal take.", "ok");
    }).catch(function () {
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      audio.onended = function () {
        URL.revokeObjectURL(url);
        updateVocalUi();
      };
      audio.play();
      setStatus("Playing your tuned vocal take.", "ok");
    });
  }

  function toggleVocalRecord() {
    if (state.vocal.recording) {
      return new Promise(function (resolve) {
        var vn = state.vocal.nodes;
        var rec = state.vocal.recorder;
        if (!rec) {
          stopVocal();
          resolve();
          return;
        }
        rec.onstop = function () {
          var wasPlaying = state.playing;
          var resumeAt = wasPlaying ? getPlayhead() : state.vocal.recordTimelineOffset || 0;
          var scoreNotes = vocalCaptureToScoreNotes(state.vocal.capturePoints);
          var added = appendVocalNotesToScore(scoreNotes);
          stopVocalMicStream();
          state.vocal.recording = false;
          state.vocal.mode = null;
          state.vocal.recorder = null;
          state.vocal.chunks = [];
          state.vocal.capturePoints = [];
          state.vocal.recordStarted = 0;
          state.vocal.recordTimelineOffset = 0;
          connectVocalToRecorder(false);
          updateVocalUi();
          if (added) {
            setStatus("Added " + added + " vocal waves at " + formatTime(resumeAt) + " — synced to timeline.", "ok");
          }
          syncScorePlaybackAfterVocal(wasPlaying, resumeAt).then(resolve);
        };
        rec.stop();
      });
    }
    if (state.vocal.liveOn) stopVocal();
    return ensureAudioGraph()
      .then(function () {
        return resumeAudioContext();
      })
      .then(function () {
        buildVocalNodes();
        refreshVocalProfile();
        return ensureMicStream(false);
      })
      .then(function () {
        wireMicToVocalChain();
        return attachVocalOctaveShifter();
      })
      .then(function () {
        state.vocal.mode = "record";
        state.vocal.recording = true;
        applyVocalMixProfile();
        applyVocalOctaveShift();
        state.vocal.chunks = [];
        state.vocal.capturePoints = [];
        state.vocal.recordTimelineOffset = getPlayhead();
        state.vocal.recordStarted = Date.now();
        state.vocal.currentHz = 0;
        connectVocalToSpeakers(false);
        connectVocalToRecorder(true);
        if (!state.vocal.nodes.recordDest || !state.vocal.nodes.recordDest.stream) {
          throw new Error("Vocal recording is not supported in this browser.");
        }
        var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
        state.vocal.recorder = new MediaRecorder(state.vocal.nodes.recordDest.stream, { mimeType: mime });
        state.vocal.recorder.ondataavailable = function (ev) {
          if (ev.data && ev.data.size) state.vocal.chunks.push(ev.data);
        };
        state.vocal.recorder.start(120);
        startVocalPitchLoop();
        updateVocalUi();
        setStatus("Recording tuned vocal — speakers muted until you stop.", "ok");
      })
      .catch(function (err) {
        stopVocal();
        setStatus(err.message || "Could not start vocal recording.", "error");
      });
  }

  function waitForVisionThenPlay(score, spells, mood, genId, options) {
    if (genId !== state.composeGen) return Promise.resolve();
    state.awaitingVision = true;
    state.playhead = 0;
    state.playing = false;
    state.livePlayback = false;
    updateTransport();
    startAudioKeepWarm();
    var visionTask;
    if (options.remix && (state.visionA || state.visionB)) {
      visionTask = Promise.resolve({ a: state.visionA, b: state.visionB });
    } else {
      if (state.composeProgress) {
        state.composeProgress.prepStep = "vision";
        state.composeProgress.label = "Painting vision from your prompt";
        tickComposeProgress();
      }
      setStatus("Painting vision behind the bars — playback starts when the image is ready…", "pending");
      visionTask = generateVisionPairForPlayback(spells, mood);
    }
    return visionTask
      .then(function (visions) {
        if (genId !== state.composeGen) return Promise.resolve();
        state.awaitingVision = false;
        var fb = fallbackVisionPair(spells);
        if (visions && (visions.a || visions.b)) {
          applyVisionImages(visions.a || fb.a, visions.b || fb.b);
        } else if (fb.a || fb.b) {
          applyVisionImages(fb.a, fb.b);
        }
        markComposeBuffersReady(visions && visions.timedOut ? "Spell preview vision — playing" : "Vision ready");
        markComposePlaybackStarting();
        stopAudioKeepWarm();
        return playLiveScore(score, 0).then(function () {
          if (genId !== state.composeGen) return;
          state.fullBuildPromise = upgradeStemsInBackground(spells, genId);
        });
      })
      .catch(function () {
        if (genId !== state.composeGen) return Promise.resolve();
        state.awaitingVision = false;
        var fb = fallbackVisionPair(spells);
        if (fb.a || fb.b) applyVisionImages(fb.a, fb.b);
        markComposeBuffersReady("Vision fallback");
        markComposePlaybackStarting();
        stopAudioKeepWarm();
        return playLiveScore(score, 0).then(function () {
          if (genId !== state.composeGen) return;
          state.fullBuildPromise = upgradeStemsInBackground(spells, genId);
        });
      });
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function fetchWithTimeout(url, options, ms) {
    ms = ms || FETCH_TIMEOUT_MS;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("Request timed out."));
      }, ms);
      fetch(url, options)
        .then(function (r) {
          clearTimeout(timer);
          resolve(r);
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function parseApiResponse(r) {
    return r.text().then(function (text) {
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (e) {
        return { error: text };
      }
    });
  }

  function paintingNumsFromApplied(spells) {
    return (spells || [])
      .map(function (s) {
        return s.paintingNum;
      })
      .filter(function (n) {
        return n != null;
      });
  }

  function buildVisionStasis(layer, mood, spells) {
    var text = mood.text || "musical soundscape from equipped spells";
    var arch = ARCHETYPE_LABELS[mood.primaryArchetype] || mood.primaryArchetype || "ambient music";
    var sfxHint = (mood.sfx || [])
      .slice(0, 5)
      .map(function (s) {
        return SFX_LABELS[s.type] || s.type;
      })
      .join(", ");
    if (layer === "light") {
      return (
        "Luminous high-key painterly vision for sound: " +
        text +
        ". Bright whites, soft glow, airy highlights, " +
        arch +
        (sfxHint ? ". Hints: " + sfxHint : "") +
        ". Abstract, musical, no text, no letters."
      );
    }
    return (
      "Shadow low-key painterly vision for sound: " +
      text +
      ". Deep blacks, rich shadows, muted contrast, " +
      arch +
      (sfxHint ? ". Echoes: " + sfxHint : "") +
      ". Abstract, musical, no text, no letters."
    );
  }

  function buildVisionPrompt(layer, mood) {
    var text = mood.text || "an imagined musical scene";
    if (layer === "light") {
      return text + " — bright luminous interpretation, high-key, glowing, for light half of a sound visualizer";
    }
    return text + " — dark shadow interpretation, low-key, deep blacks, for shadow half of a sound visualizer";
  }

  function pollVisionJob(jobId, attemptsLeft, firstPoll) {
    if (attemptsLeft == null) attemptsLeft = 80;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Vision generation timed out."));
    var pollOnce = function () {
      return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 25000);
    };
    var startPoll = firstPoll
      ? new Promise(function (resolve) {
          setTimeout(resolve, FIRST_POLL_DELAY_MS);
        }).then(pollOnce)
      : pollOnce();
    return startPoll
      .then(parseApiResponse)
      .then(function (job) {
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No vision image returned.");
        }
        if (job.status === "failed") {
          throw new Error((job.error && job.error.message) || "Vision generation failed.");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, POLL_INTERVAL_MS);
        }).then(function () {
          return pollVisionJob(jobId, attemptsLeft - 1, false);
        });
      });
  }

  function requestVisionImage(layer, mood, spells) {
    var jobId =
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "ea-" + layer + "-" + Date.now()) + "-" + Math.floor(Math.random() * 9999);
    return fetchWithTimeout(
      apiUrl("/api/generate-stasis-vision"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          stasis: buildVisionStasis(layer, mood, spells),
          buzz_words: (mood.labels || []).slice(0, 6).join(" "),
          spells: paintingNumsFromApplied(spells),
          aspect_ratio: "3:4",
          mag_fresh: true,
          prompt: buildVisionPrompt(layer, mood),
        }),
      },
      FETCH_TIMEOUT_MS
    )
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollVisionJob((d && d.job_id) || jobId, null, true);
          });
        }
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Vision generate failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No vision image returned.");
        });
      });
  }

  function fallbackVisionPair(spells) {
    var a = "";
    var b = "";
    if (spells && spells.length) {
      a = spells[0].url || "";
      b = (spells[1] && spells[1].url) || spells[0].url || "";
    }
    return { a: a, b: b };
  }

  function generateVisionPair(spells, mood) {
    state.visionsGenerating = true;
    var lightP = requestVisionImage("light", mood, spells).catch(function () {
      return null;
    });
    var darkP = requestVisionImage("dark", mood, spells).catch(function () {
      return null;
    });
    return Promise.all([lightP, darkP])
      .then(function (urls) {
        var fb = fallbackVisionPair(spells);
        return { a: urls[0] || fb.a, b: urls[1] || fb.b };
      })
      .catch(function () {
        return fallbackVisionPair(spells);
      })
      .finally(function () {
        state.visionsGenerating = false;
      });
  }

  function generateVisionPairForPlayback(spells, mood) {
    var fb = fallbackVisionPair(spells);
    var pending = generateVisionPair(spells, mood);
    var timeout = new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ a: fb.a, b: fb.b, timedOut: true });
      }, VISION_PLAY_WAIT_MS);
    });
    return Promise.race([pending, timeout]).then(function (visions) {
      if (visions && visions.timedOut) {
        pending
          .then(function (late) {
            if (late && (late.a || late.b)) applyVisionImages(late.a || fb.a, late.b || fb.b);
          })
          .catch(function () {});
        return visions;
      }
      if (visions && (visions.a || visions.b)) return visions;
      return fb;
    });
  }

  function applyVisionImages(urlA, urlB) {
    state.visionA = urlA || "";
    state.visionB = urlB || "";
    var stage = $("ea-stage");
    var back = $("ea-vis-back");
    if (!stage) return;
    if (urlA) stage.style.setProperty("--ea-vis-a", 'url("' + urlA + '")');
    if (urlB) {
      stage.style.setProperty("--ea-vis-b", 'url("' + urlB + '")');
      if (back) back.style.backgroundImage = 'url("' + urlB + '")';
    }
    if (urlA || urlB) stage.classList.add("ea-has-vision");
    layoutBarVisionSlices();
  }

  function applyBarVisionSlice(el, i, n, sizePct) {
    if (!el) return;
    el.style.backgroundSize = sizePct + "% 200%";
    var t = n <= 1 ? 0.5 : i / (n - 1);
    var pos = 12 + Math.pow(t, 1.42) * 76;
    el.style.backgroundPosition = pos + "% " + (el.classList.contains("ea-bar-up") ? "100%" : "0%");
  }

  function freqBinForBar(barIndex, barCount, binCount) {
    var t0 = barIndex / barCount;
    var t1 = (barIndex + 1) / barCount;
    var b0 = Math.floor(Math.pow(t0, 1.65) * (binCount - 1));
    var b1 = Math.max(b0 + 1, Math.floor(Math.pow(t1, 1.65) * (binCount - 1)));
    return { start: b0, end: Math.min(binCount, b1 + 1) };
  }

  function sampleBarSpectrum(values, barIndex, barCount) {
    var range = freqBinForBar(barIndex, barCount, values.length);
    var sum = 0;
    var count = 0;
    var b;
    for (b = range.start; b < range.end; b++) {
      sum += values[b] || 0;
      count++;
    }
    var v = count ? sum / count : 0;
    var center = (barCount - 1) * 0.5;
    var dist = Math.abs(barIndex - center) / Math.max(1, center);
    var midBoost = 1 + (1 - dist) * 0.62;
    var bassTrim = barIndex < 4 ? 0.82 : barIndex < 8 ? 0.92 : 1;
    var trebleTrim = barIndex > barCount - 4 ? 0.9 : 1;
    return v * midBoost * bassTrim * trebleTrim;
  }

  function layoutBarVisionSlices() {
    var cols = state.barCols;
    if (!cols.length) return;
    var n = cols.length;
    var sizePct = n * 100;
    cols.forEach(function (col, i) {
      applyBarVisionSlice(col.up, i, n, sizePct);
      applyBarVisionSlice(col.down, i, n, sizePct);
    });
  }

  function updateScanline() {
    var line = $("ea-scanline");
    var stage = $("ea-stage");
    if (!line || !stage) return;
    var dur = bufferDuration();
    var head = Math.min(getPlayhead(), dur);
    var pct = dur > 0.05 ? (head / dur) * 100 : 0;
    line.style.left = pct + "%";
  }

  function formatTime(seconds) {
    seconds = Math.max(0, seconds || 0);
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function bufferDuration() {
    if (scoreNeedsLivePlayback() && state.scoreEdit && state.scoreEdit.duration) {
      return state.scoreEdit.duration;
    }
    if (state.stemsFullReady && state.stems && state.stems.melody && state.stems.melody.duration) {
      return state.stems.melody.duration;
    }
    if (state.stems && state.stems.melody && state.stems.melody.duration) {
      return state.stems.melody.duration;
    }
    if (state.fullBuildActive || state.awaitingFullContinue) {
      return SOUND_DURATION;
    }
    if (state.liveScore && state.liveScore.duration) {
      return state.liveScore.duration;
    }
    return state.buffer && state.buffer.duration ? state.buffer.duration : SOUND_DURATION;
  }

  function scoreHasVocalNotes(notes) {
    var list = notes || (state.scoreEdit && state.scoreEdit.notes) || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].stem === "vocal") return true;
    }
    return false;
  }

  function scoreNeedsLivePlayback() {
    var ed = state.scoreEdit;
    if (!ed || !ed.notes.length) return false;
    if (ed.dirty || scoreHasVocalNotes(ed.notes)) return true;
    return false;
  }

  function shouldUseLiveScore(offset) {
    if (scoreNeedsLivePlayback()) {
      var liveDur = (state.scoreEdit && state.scoreEdit.duration) || SOUND_DURATION;
      if (offset >= liveDur - 0.05) return false;
      return true;
    }
    if (state.stemsFullReady && state.stems) return false;
    if (!state.liveScore || !state.liveScore.notes || !state.liveScore.notes.length) return false;
    if (offset >= state.liveScore.duration - 0.05) return false;
    if (state.livePlayback) return true;
    if (state.scoreEdit && state.scoreEdit.visible) return true;
    return false;
  }

  function tryContinuePastPreview(head) {
    head = head == null ? getPlayhead() : head;
    if (state.stemsFullReady && state.stems && state.stems.melody && !scoreNeedsLivePlayback()) {
      state.awaitingFullContinue = false;
      state.livePlayback = false;
      state.liveScore = null;
      head = Math.min(head, state.stems.melody.duration - 0.02);
      setStatus("Continuing full track at " + formatTime(head) + "…", "pending");
      return startPlaybackAt(head).then(function () {
        setStatus("Full ~3:00 playing — loops at the end.", "ok");
      });
    }
    if (state.stems && state.stems.melody && head < state.stems.melody.duration - 0.05) {
      state.livePlayback = false;
      setStatus("Continuing at " + formatTime(head) + "…", "pending");
      return startPlaybackAt(head).then(function () {
        setStatus("Playing — full render still building past " + formatTime(state.stems.melody.duration) + "…", "ok");
      });
    }
    state.awaitingFullContinue = true;
    state.playing = false;
    state.playhead = Math.max(head, 0);
    stopVisualizer();
    updateTransport();
    setStatus(
      "Waiting for full ~3:00 render" + (state.fullBuildActive ? " — will continue automatically…" : "…"),
      "pending"
    );
    return Promise.resolve();
  }

  function loopPlayback() {
    stopVocalPlaybackSource();
    state.awaitingFullContinue = false;
    state.playhead = 0;
    state.paused = false;
    updateTransport();
    updateScanline();
    setStatus("Looping from 0:00…", "ok");
    return startPlaybackAt(0);
  }

  function handlePlaybackEnded(dur) {
    state.playing = false;
    state.paused = false;
    state.playhead = dur;
    stopVisualizer();
    updateTransport();
    if (!state.stemsFullReady && dur < SOUND_DURATION - 8) {
      return tryContinuePastPreview(dur);
    }
    return loopPlayback();
  }

  function hasSoundReady() {
    return !!(state.stems && state.stems.melody) || !!state.buffer || !!state.liveScore;
  }

  function getPlayhead() {
    if (state.playing && state.audioCtx) {
      var rate = state.playbackRate || 1;
      return state.playhead + (state.audioCtx.currentTime - state.playbackStartCtxTime) * rate;
    }
    return state.playhead;
  }

  function updateTransport() {
    var dur = bufferDuration();
    var head = Math.min(getPlayhead(), dur);
    if (state.scoreEdit && state.scoreEdit.visible) {
      renderScoreRoll();
    }
    var cur = $("ea-time-cur");
    var durEl = $("ea-time-dur");
    var seek = $("ea-seek");
    var playBtn = $("ea-play-btn");
    var pauseBtn = $("ea-pause-btn");
    var resetBtn = $("ea-reset-btn");
    var hasBuf = hasSoundReady();

    if (cur) cur.textContent = formatTime(head);
    if (durEl) durEl.textContent = formatTime(dur);
    if (seek) {
      seek.disabled = !hasBuf;
      seek.max = String(dur);
      if (!state.scrubbing) seek.value = String(head);
    }
    if (playBtn) playBtn.disabled = !hasBuf || state.generating;
    if (pauseBtn) pauseBtn.disabled = !state.playing;
    if (resetBtn) resetBtn.disabled = !hasBuf;
    updateRemixButton();
    updateHarmonyPlayhead(head);
  }

  function loadSavedOutputDevice() {
    try {
      var saved = localStorage.getItem(AUDIO_OUTPUT_KEY);
      if (saved != null) state.outputDeviceId = saved;
    } catch (eLoad) {}
    loadKnownOutputDevices();
    if (state.outputDeviceId && looksLikeMicOutput(labelForOutputDeviceId(state.outputDeviceId))) {
      saveOutputDevice("");
    }
  }

  function loadKnownOutputDevices() {
    state.knownOutputDevices = [];
    try {
      var raw = localStorage.getItem(AUDIO_OUTPUT_DEVICES_KEY);
      if (raw) state.knownOutputDevices = JSON.parse(raw) || [];
    } catch (eKnown) {
      state.knownOutputDevices = [];
    }
  }

  function saveKnownOutputDevices() {
    try {
      localStorage.setItem(AUDIO_OUTPUT_DEVICES_KEY, JSON.stringify(state.knownOutputDevices));
    } catch (eSaveList) {}
  }

  function saveOutputDevice(id) {
    state.outputDeviceId = id || "";
    try {
      if (id) localStorage.setItem(AUDIO_OUTPUT_KEY, id);
      else localStorage.removeItem(AUDIO_OUTPUT_KEY);
    } catch (eSave) {}
  }

  function rememberOutputDevice(device) {
    if (!device || !device.deviceId) return;
    var label = device.label || "";
    var list = state.knownOutputDevices;
    for (var i = 0; i < list.length; i++) {
      if (list[i].deviceId === device.deviceId) {
        if (label) list[i].label = label;
        saveKnownOutputDevices();
        return;
      }
    }
    list.push({ deviceId: device.deviceId, label: label || "Speakers" });
    saveKnownOutputDevices();
  }

  function labelForOutputDeviceId(deviceId) {
    if (!deviceId) return "System default";
    var sel = $("ea-audio-output");
    if (sel) {
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === deviceId) return sel.options[i].text;
      }
    }
    for (var j = 0; j < state.knownOutputDevices.length; j++) {
      if (state.knownOutputDevices[j].deviceId === deviceId) return state.knownOutputDevices[j].label;
    }
    return "";
  }

  function audioOutputRoutingSupported() {
    return !!(state.audioCtx && typeof state.audioCtx.setSinkId === "function");
  }

  function outputDeviceLabel(dev, index) {
    if (dev.label) return dev.label;
    return "Speakers " + (index + 1);
  }

  function looksLikeMicOutput(label) {
    return /\b(mic|microphone|input|capture|recording)\b/i.test(label || "");
  }

  function collectOutputDevices(devices) {
    var seen = {};
    var outputs = [];
    function add(dev) {
      if (!dev || !dev.deviceId || seen[dev.deviceId]) return;
      var label = dev.label || "";
      if (looksLikeMicOutput(label)) return;
      seen[dev.deviceId] = true;
      outputs.push({ deviceId: dev.deviceId, label: label });
    }
    (devices || []).forEach(function (d) {
      if (d.kind === "audiooutput") add(d);
    });
    state.knownOutputDevices.forEach(add);
    return outputs;
  }

  function reconcileSavedOutputDevice(outputs) {
    if (!outputs.length) return;
    var saved = state.outputDeviceId || "";
    if (!saved) return;
    var found = outputs.some(function (d) {
      return d.deviceId === saved;
    });
    if (!found) saveOutputDevice("");
  }

  function setOutputSelectLoading(loading) {
    var sel = $("ea-audio-output");
    if (!sel) return;
    var pending = sel.querySelector('option[data-ea-loading="1"]');
    if (!loading) {
      if (pending) pending.remove();
      return;
    }
    if (pending) return;
    var opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Loading speakers…";
    opt.disabled = true;
    opt.setAttribute("data-ea-loading", "1");
    sel.insertBefore(opt, sel.options[1] || null);
  }

  function updateOutputRoutingUi(devices) {
    var sel = $("ea-audio-output");
    var wrap = $("ea-audio-routing");
    if (!sel) return;
    var previous = sel.value || state.outputDeviceId || "";
    var outputs = collectOutputDevices(devices);
    reconcileSavedOutputDevice(outputs);
    var target = state.outputDeviceId || previous || "";
    sel.innerHTML = "";
    var defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.textContent = "System default";
    sel.appendChild(defOpt);
    outputs.forEach(function (d, i) {
      var opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = outputDeviceLabel(d, i);
      sel.appendChild(opt);
    });
    if (outputs.length === 1 && !target) {
      target = outputs[0].deviceId;
    }
    var hasTarget = target && Array.prototype.some.call(sel.options, function (o) {
      return o.value === target;
    });
    sel.value = hasTarget ? target : "";
    if (wrap) {
      wrap.classList.toggle("ea-audio-routing-unsupported", !!state.audioCtx && !audioOutputRoutingSupported());
    }
  }

  function unlockMediaDeviceLabels() {
    if (state.mediaLabelsUnlocked) return Promise.resolve();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve();
    return navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
      .then(function (stream) {
        stream.getTracks().forEach(function (track) {
          try {
            track.stop();
          } catch (eStop) {}
        });
        state.mediaLabelsUnlocked = true;
      })
      .catch(function () {});
  }

  function enumerateOutputDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return Promise.resolve([]);
    }
    return navigator.mediaDevices.enumerateDevices();
  }

  function storeEnumeratedOutputs(devices) {
    (devices || []).forEach(function (d) {
      if (d.kind === "audiooutput") rememberOutputDevice(d);
    });
    updateOutputRoutingUi(devices);
    return collectOutputDevices(devices);
  }

  function requestOutputAccessFallback() {
    if (state.outputPickerAttempted) return Promise.resolve([]);
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.selectAudioOutput !== "function") {
      return Promise.resolve([]);
    }
    state.outputPickerAttempted = true;
    var pickerOpts = state.outputDeviceId ? { deviceId: state.outputDeviceId } : undefined;
    return navigator.mediaDevices
      .selectAudioOutput(pickerOpts)
      .then(function (picked) {
        rememberOutputDevice(picked);
        saveOutputDevice(picked.deviceId);
        return enumerateOutputDevices();
      })
      .then(function (devices) {
        return storeEnumeratedOutputs(devices);
      })
      .then(function (outputs) {
        if (state.outputDeviceId) return applyAudioOutput(state.outputDeviceId).then(function () { return outputs; });
        return outputs;
      })
      .catch(function (err) {
        if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) return [];
        return [];
      });
  }

  function primeOutputDeviceList() {
    if (state.outputEnumBusy && state.outputEnumPromise) return state.outputEnumPromise;
    state.outputEnumBusy = true;
    setOutputSelectLoading(true);
    state.outputEnumPromise = ensureAudioGraph()
      .then(function () {
        return resumeAudioContext();
      })
      .then(function () {
        return unlockMediaDeviceLabels();
      })
      .then(function () {
        return enumerateOutputDevices();
      })
      .then(function (devices) {
        var outputs = collectOutputDevices(devices);
        if (outputs.length) return storeEnumeratedOutputs(devices);
        return new Promise(function (resolve) {
          setTimeout(resolve, 120);
        })
          .then(function () {
            return enumerateOutputDevices();
          })
          .then(function (devicesRetry) {
            var outputsRetry = collectOutputDevices(devicesRetry);
            if (outputsRetry.length) return storeEnumeratedOutputs(devicesRetry);
            return requestOutputAccessFallback();
          });
      })
      .catch(function () {
        updateOutputRoutingUi([]);
        return [];
      })
      .then(function (outputs) {
        setOutputSelectLoading(false);
        state.outputEnumBusy = false;
        return outputs;
      });
    return state.outputEnumPromise;
  }

  function warnIfMicSelectedAsOutput() {
    var label = labelForOutputDeviceId(state.outputDeviceId);
    if (looksLikeMicOutput(label)) {
      setStatus("Speakers are set to a microphone — pick your TV or monitor in the list.", "err");
    }
  }

  function applyAudioOutput(deviceId) {
    if (!state.audioCtx || typeof state.audioCtx.setSinkId !== "function") return Promise.resolve();
    var id = deviceId != null ? deviceId : state.outputDeviceId;
    id = id || "";
    return state.audioCtx.setSinkId(id).then(function () {
      saveOutputDevice(id);
      var sel = $("ea-audio-output");
      if (sel && sel.value !== id) sel.value = id;
      warnIfMicSelectedAsOutput();
      return id;
    }).catch(function () {
      if (!id) return Promise.reject(new Error("setSinkId failed"));
      saveOutputDevice("");
      var sel = $("ea-audio-output");
      if (sel) sel.value = "";
      return state.audioCtx.setSinkId("");
    });
  }

  function ensureAudioGraph() {
    if (!state.audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("Web Audio not supported in this browser.");
      state.audioCtx = new AC();
      state.analyser = state.audioCtx.createAnalyser();
      state.analyser.fftSize = 256;
      state.analyser.smoothingTimeConstant = 0.82;
      state.masterGain = state.audioCtx.createGain();
      state.masterGain.gain.value = getTweaks().volume;
      state.analyser.connect(state.masterGain);
      state.masterGain.connect(state.audioCtx.destination);
      state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
      buildMixNodes();
      var routeWrap = $("ea-audio-routing");
      if (routeWrap) routeWrap.classList.toggle("ea-audio-routing-unsupported", !audioOutputRoutingSupported());
    }
    var resumeP =
      state.audioCtx.state === "suspended" ? state.audioCtx.resume() : Promise.resolve();
    return resumeP.then(function () {
      if (audioOutputRoutingSupported()) return applyAudioOutput(state.outputDeviceId);
    });
  }

  function splitStemBuffer(rendered) {
    var len = rendered.length;
    var sr = rendered.sampleRate;
    function stem(chL, chR) {
      var out;
      if (state.audioCtx) out = state.audioCtx.createBuffer(2, len, sr);
      else out = new OfflineAudioContext(2, 1, sr).createBuffer(2, len, sr);
      out.copyToChannel(rendered.getChannelData(chL), 0);
      out.copyToChannel(rendered.getChannelData(chR), 1);
      return out;
    }
    return {
      melody: stem(0, 1),
      colors: stem(2, 3),
      spells: stem(4, 5),
    };
  }

  function makePinkNoise(ctx, seconds) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var b0 = 0;
    var b1 = 0;
    var b2 = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      data[i] = (b0 + b1 + b2 + white * 0.5362) * 0.11;
    }
    return buf;
  }

  function softTone(ctx, dest, t0, freq, dur, peak, attack, release) {
    attack = attack == null ? 0.06 : attack;
    release = release == null ? Math.min(1.5, dur * 0.45) : release;
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t0);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function playfulTone(ctx, dest, t0, freq, dur, peak, slideTo, wave) {
    var osc = ctx.createOscillator();
    osc.type = wave || "triangle";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur * 0.55);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function melodicNote(ctx, dest, t0, freq, dur, peak, octaveMul) {
    octaveMul = octaveMul == null ? 1 : octaveMul;
    playfulTone(ctx, dest, t0, freq * octaveMul, dur, peak, null, "triangle");
  }

  function musicalBell(ctx, dest, t0, freq, peak) {
    playfulTone(ctx, dest, t0, freq, 0.4, peak * 0.72, freq * 1.06, "sine");
    playfulTone(ctx, dest, t0, freq * 2, 0.28, peak * 0.28, null, "sine");
  }

  function noteAt(key, degree, octave) {
    octave = Math.max(MIN_PLAY_OCTAVE, octave == null ? MIN_PLAY_OCTAVE : octave);
    return degreeFreq(key, degree % key.ratios.length) * octave;
  }

  function renderGameBlip(ctx, dest, t0, key, peak, rnd) {
    var deg = Math.floor(rnd() * 5);
    var f0 = noteAt(key, deg, 3);
    var f1 = noteAt(key, (deg + 2) % 5, 4);
    playfulTone(ctx, dest, t0, f0, 0.07, peak * 0.65, f1, "triangle");
    if (rnd() > 0.4) {
      playfulTone(ctx, dest, t0 + 0.09 + rnd() * 0.06, f1, 0.06, peak * 0.45, f1 * 1.06, "sine");
    }
  }

  function renderGameCoin(ctx, dest, t0, key, peak, rnd) {
    var d = Math.floor(rnd() * 5);
    playfulTone(ctx, dest, t0, noteAt(key, d, 3), 0.06, peak * 0.55, noteAt(key, d, 4), "square");
    playfulTone(ctx, dest, t0 + 0.08, noteAt(key, (d + 2) % 5, 4), 0.12, peak * 0.5, null, "triangle");
  }

  function renderGameSparkle(ctx, dest, t0, key, peak, rnd, count) {
    count = count || 3 + Math.floor(rnd() * 3);
    for (var s = 0; s < count; s++) {
      playfulTone(
        ctx,
        dest,
        t0 + s * (0.11 + rnd() * 0.14),
        noteAt(key, (s + Math.floor(rnd() * 3)) % 5, 4 + (s % 2)),
        0.05 + rnd() * 0.04,
        peak * (0.35 + rnd() * 0.25),
        null,
        rnd() > 0.5 ? "sine" : "triangle"
      );
    }
  }

  function renderPlayfulRhythm(ctx, dest, t0, key, peak, rnd) {
    var rhythm = PLAY_RHYTHMS[Math.floor(rnd() * PLAY_RHYTHMS.length)];
    var cursor = 0;
    rhythm.forEach(function (gap, i) {
      var st = t0 + cursor;
      cursor += gap;
      if (i % 3 === 0) renderGameCoin(ctx, dest, st, key, peak * 0.85, rnd);
      else if (i % 3 === 1) renderGameBlip(ctx, dest, st, key, peak * 0.75, rnd);
      else musicalBell(ctx, dest, st, noteAt(key, i % 5, 3), peak * 0.55);
    });
  }

  function renderChordPad(ctx, dest, t0, dur, key, chordDegrees, peak) {
    var deg = chordDegrees[1] != null ? chordDegrees[1] : chordDegrees[0];
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = noteAt(key, deg, 2);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak * 0.55, t0 + 0.45);
    g.gain.setValueAtTime(peak * 0.48, t0 + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function renderArpeggioOnGrid(ctx, dest, comp, bar, key, chord, peak, patternIdx, renderOpts) {
    renderOpts = renderOpts || {};
    var pattern = ARPEGGIO_PATTERNS[patternIdx % ARPEGGIO_PATTERNS.length];
    var barT = barLocalTime(comp, bar, renderOpts);
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var i;
    var rel;
    var t;
    var deg;
    for (i = 0; i < 4; i++) {
      rel = pattern[i * 2] != null ? pattern[i * 2] : pattern[i];
      t = barT + i * comp.eighth * 2;
      if (t < -0.02 || t >= chunkDur - 0.02) break;
      deg = chord[rel % chord.length];
      playfulTone(ctx, dest, t, noteAt(key, deg, 3 + (i % 2)), comp.eighth * 1.6, peak, null, "triangle");
    }
  }

  function renderArpeggioPhrase(ctx, dest, t0, key, peak, spacing, patternIdx, rnd, octave) {
    var pattern = ARPEGGIO_PATTERNS[patternIdx % ARPEGGIO_PATTERNS.length];
    var oct = Math.max(3, octave || 3);
    pattern.forEach(function (deg, i) {
      playfulTone(ctx, dest, t0 + i * spacing, noteAt(key, deg, oct), spacing * 0.8, peak, null, "triangle");
    });
  }

  function renderMotifOnGrid(ctx, dest, comp, bar, key, chord, peak, shapeIdx, renderOpts) {
    renderOpts = renderOpts || {};
    var shape = MELODY_SHAPES[shapeIdx % MELODY_SHAPES.length];
    var barT = barLocalTime(comp, bar, renderOpts);
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    shape.forEach(function (rel, i) {
      var t = barT + i * comp.eighth;
      if (t < -0.02 || t >= chunkDur - 0.02) return;
      var deg = chord[rel % chord.length];
      playfulTone(ctx, dest, t, noteAt(key, deg, 4), comp.eighth * 0.75, peak, null, "sine");
    });
  }

  function renderMotifPhrase(ctx, dest, t0, key, peak, rnd, length) {
    length = length || 8;
    for (var i = 0; i < length; i++) {
      playfulTone(ctx, dest, t0 + i * 0.35, noteAt(key, i % 5, 3 + (i % 2)), 0.3, peak, null, "triangle");
    }
  }

  function renderChoirPhrase(ctx, dest, t0, dur, key, chord, peak, soft) {
    var degrees = soft ? [chord[1], chord[2]] : chord.slice();
    degrees.forEach(function (deg, i) {
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = noteAt(key, deg, 3);
      osc.detune.value = (i - 1) * 6;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak * (0.3 + i * 0.06), t0 + 0.4);
      g.gain.setValueAtTime(peak * 0.22, t0 + dur - 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(dest);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });
  }

  function renderBreathSwell(ctx, dest, t0, dur, key, peak, rnd) {
    dur = Math.min(4, Math.max(0.8, dur));
    var osc = ctx.createOscillator();
    osc.type = "sine";
    var f0 = noteAt(key, 4, 4);
    osc.frequency.setValueAtTime(f0 * 0.98, t0);
    osc.frequency.linearRampToValueAtTime(f0 * 1.04, t0 + dur * 0.5);
    osc.frequency.linearRampToValueAtTime(f0 * 0.99, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function renderTunedPercussion(ctx, dest, t0, key, peak, rnd, degree) {
    renderGameCoin(ctx, dest, t0, key, peak, rnd);
    musicalBell(ctx, dest, t0 + 0.05, noteAt(key, degree == null ? Math.floor(rnd() * 5) : degree, 4), peak * 0.6);
  }

  function renderMelodicRain(ctx, dest, t0, key, peak, rnd) {
    renderGameSparkle(ctx, dest, t0, key, peak * 0.7, rnd, 3 + Math.floor(rnd() * 3));
  }

  function dropSpacing(mood) {
    if (mood.tempo < 0.75) return 2.4;
    if (mood.tempo > 1.25) return 0.95;
    if (mood.density < 0.65) return 2.0;
    if (mood.density > 1.25) return 1.0;
    return 1.45;
  }

  function atFrac(duration, frac) {
    return Math.max(0.2, duration * frac);
  }

  function noiseBurst(ctx, dest, t0, dur, peak, filterHz, filterQ, filterType) {
    var noise = ctx.createBufferSource();
    noise.buffer = makePinkNoise(ctx, dur + 0.08);
    var filt = ctx.createBiquadFilter();
    filt.type = filterType || "bandpass";
    filt.frequency.value = filterHz || 1200;
    filt.Q.value = filterQ == null ? 1.1 : filterQ;
    var g = ctx.createGain();
    var atk = Math.min(0.03, dur * 0.25);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    noise.connect(filt);
    filt.connect(g);
    g.connect(dest);
    noise.start(t0);
    noise.stop(t0 + dur + 0.08);
  }

  function renderMusicalAnimal(ctx, dest, t0, type, key, peak, rnd) {
    if (type === "bird" || type === "insect" || type === "rooster") {
      renderArpeggioPhrase(ctx, dest, t0, key, peak, 0.1 + rnd() * 0.06, Math.floor(rnd() * 4), rnd, 3);
    } else if (type === "frog" || type === "wolf" || type === "roar") {
      renderMotifPhrase(ctx, dest, t0, key, peak * 0.9, rnd, 4);
      renderGameBlip(ctx, dest, t0 + 0.4, key, peak * 0.5, rnd);
    } else {
      renderGameCoin(ctx, dest, t0, key, peak * 0.85, rnd);
      renderMotifPhrase(ctx, dest, t0 + 0.25, key, peak * 0.55, rnd, 3);
    }
  }

  function renderSceneAccent(ctx, dest, comp, bar, type, key, peak, renderOpts) {
    renderOpts = renderOpts || {};
    var chord = comp.progression[bar % comp.totalBars];
    var t0 = barLocalTime(comp, bar, renderOpts);
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var phraseDur = comp.barDur * 2;
    if (t0 < -0.02 || t0 >= chunkDur - 0.1) return;

    if (type === "speech" || type === "crowd" || type === "whisper" || type === "laugh" || type === "cry") {
      renderChoirPhrase(ctx, dest, t0, phraseDur, key, chord, peak, type === "whisper" || type === "cry");
    } else if (type === "rain" || type === "splash") {
      renderArpeggioOnGrid(ctx, dest, comp, bar, key, chord, peak * 0.85, bar);
    } else if (type === "gust" || type === "wind") {
      renderBreathSwell(ctx, dest, t0, phraseDur, key, peak * 0.7, null);
    } else if (type === "rustle" || type === "crack") {
      renderArpeggioOnGrid(ctx, dest, comp, bar, key, chord, peak * 0.75, bar + 1);
    } else if (type === "bell_sfx" || type === "phone" || type === "tick") {
      musicalBell(ctx, dest, t0, noteAt(key, chord[0], 3), peak);
    } else if (type === "footsteps" || type === "pulse") {
      [0, 1, 2, 3].forEach(function (beat) {
        musicalBell(ctx, dest, t0 + beat * comp.beatDur, noteAt(key, chord[beat % 3], 3), peak * 0.55);
      });
    } else if (type === "fire_crackle") {
      for (var fc = 0; fc < 8; fc++) {
        playfulTone(ctx, dest, t0 + fc * comp.sixteenth, noteAt(key, chord[fc % 3], 4), comp.sixteenth * 0.7, peak * 0.4, null, "triangle");
      }
    } else if (type === "siren") {
      var osc = ctx.createOscillator();
      osc.type = "sine";
      var dur = phraseDur;
      var fA = noteAt(key, chord[1], 4);
      var fB = noteAt(key, chord[2], 4);
      osc.frequency.setValueAtTime(fA, t0);
      osc.frequency.linearRampToValueAtTime(fB, t0 + dur * 0.5);
      osc.frequency.linearRampToValueAtTime(fA, t0 + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(dest);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } else if (
      type === "dog" ||
      type === "cat" ||
      type === "bird" ||
      type === "cow" ||
      type === "horse" ||
      type === "wolf" ||
      type === "sheep" ||
      type === "pig" ||
      type === "rooster" ||
      type === "insect" ||
      type === "frog" ||
      type === "roar"
    ) {
      renderMotifOnGrid(ctx, dest, comp, bar, key, chord, peak * 0.8, bar);
    } else if (type === "hit" || type.indexOf("hit_") === 0 || type === "door_slam" || type === "knock" || type === "glass_break" || type === "explosion" || type === "gunshot" || type === "thunder") {
      musicalBell(ctx, dest, t0, noteAt(key, chord[0], 3), peak);
      musicalBell(ctx, dest, t0 + comp.beatDur, noteAt(key, chord[2], 4), peak * 0.7);
    } else if (type === "door_creak") {
      renderMotifOnGrid(ctx, dest, comp, bar, key, chord, peak * 0.65, bar + 2);
    } else if (type === "traffic" || type === "typing" || type === "eating") {
      renderArpeggioOnGrid(ctx, dest, comp, bar, key, chord, peak * 0.6, bar + 3);
    } else if (type === "shout") {
      renderChoirPhrase(ctx, dest, t0, comp.barDur, key, chord, peak, false);
    } else {
      renderMotifOnGrid(ctx, dest, comp, bar, key, chord, peak * 0.7, bar + 1);
    }
  }

  function sectionSfxMul(section) {
    if (section === "intro") return 0.45;
    if (section === "verse" || section === "bridge") return 0.85;
    if (section === "hook") return 1.05;
    if (section === "chorus") return 1.2;
    if (section === "outro") return 0.65;
    return 1;
  }

  function renderPromptSfx(ctx, dest, mood, comp, key, renderOpts) {
    renderOpts = renderOpts || {};
    var lite = !!renderOpts.lite;
    var peakBase = 0.24 * (0.9 + (mood.clarity || 0.5) * 0.4);
    var map = mood.wordSceneMap || [];
    var mapLimit = lite ? Math.min(4, map.length) : map.length;
    var bar;
    var sec;
    var peak;
    var wi;
    var entry;
    var si;
    var sfx;
    var step;
    var stepMul = lite ? 2 : 1;

    for (wi = 0; wi < mapLimit; wi++) {
      entry = map[wi];
      peak = peakBase * entry.weight;
      for (bar = entry.barOffset; bar < comp.totalBars; bar += entry.step * stepMul) {
        if (!barInChunk(comp, bar, renderOpts)) continue;
        sec = sectionAt(comp, bar);
        renderSceneAccent(ctx, dest, comp, bar, entry.type, key, peak * sectionSfxMul(sec), renderOpts);
      }
    }

    if (!mood.sfx || !mood.sfx.length) return;
    step = mood.density > 1.2 ? 2 : mood.density < 0.8 ? 4 : 3;
    if (lite) step = Math.max(step, 4);
    var sfxLimit = lite ? Math.min(4, mood.sfx.length) : mood.sfx.length;
    for (si = 0; si < sfxLimit; si++) {
      sfx = mood.sfx[si];
      peak = peakBase * 0.9 * Math.min(1.45, sfx.weight || 1);
      for (bar = si % step; bar < comp.totalBars; bar += step) {
        if (!barInChunk(comp, bar, renderOpts)) continue;
        sec = sectionAt(comp, bar);
        if (sec === "intro" && bar > 1) continue;
        renderSceneAccent(ctx, dest, comp, bar, sfx.type, key, peak * sectionSfxMul(sec), renderOpts);
      }
    }
  }

  function renderMelodyShape(ctx, dest, comp, startBar, key, chord, peak, shape, spacing, renderOpts) {
    renderOpts = renderOpts || {};
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var i;
    var t;
    var deg;
    for (i = 0; i < shape.length; i++) {
      t = barLocalTime(comp, startBar, renderOpts) + i * spacing;
      if (t < -0.02 || t >= chunkDur - 0.02) break;
      deg = chord[shape[i] % chord.length];
      playfulTone(ctx, dest, t, noteAt(key, deg, 4 + (i % 2)), spacing * 0.78, peak, null, "sine");
    }
  }

  function renderHookLine(ctx, dest, comp, bar, key, peak, renderOpts) {
    if (bar + 1 >= comp.totalBars) return;
    var chord = comp.progression[bar];
    var shape = HOOK_SHAPES[comp.hookIdx];
    renderMelodyShape(ctx, dest, comp, bar, key, chord, peak, shape, comp.eighth, renderOpts);
    chord = comp.progression[bar + 1];
    renderMelodyShape(
      ctx,
      dest,
      comp,
      bar + 1,
      key,
      chord,
      peak * 0.92,
      shape.slice().reverse(),
      comp.eighth,
      renderOpts
    );
  }

  function renderChorusLine(ctx, dest, comp, bar, key, peak, renderOpts) {
    renderOpts = renderOpts || {};
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var chord = comp.progression[bar];
    var shape = CHORUS_SHAPES[comp.chorusIdx];
    var notesPerBar = 8;
    var spacing = comp.eighth;
    var i;
    var t;
    var deg;
    for (i = 0; i < notesPerBar; i++) {
      t = barLocalTime(comp, bar, renderOpts) + i * spacing;
      if (t < -0.02 || t >= chunkDur - 0.02) break;
      deg = chord[shape[i % shape.length] % chord.length];
      playfulTone(ctx, dest, t, noteAt(key, deg, 4 + (i % 2)), spacing * 0.8, peak, null, "sine");
    }
  }

  function renderIntroLift(ctx, dest, comp, key, peak, renderOpts) {
    renderOpts = renderOpts || {};
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var bar;
    var chord;
    var barT;
    var introBars = 0;
    for (bar = 0; bar < comp.totalBars && sectionAt(comp, bar) === "intro"; bar++) introBars++;
    if (!introBars) return;

    for (bar = 0; bar < introBars; bar++) {
      if (!barInChunk(comp, bar, renderOpts)) continue;
      chord = comp.progression[bar];
      barT = barLocalTime(comp, bar, renderOpts);
      if (barT >= chunkDur - 0.05) break;
      musicalBell(ctx, dest, barT, noteAt(key, chord[0], 3), peak * (0.45 + bar * 0.12));
      if (bar === introBars - 1) {
        renderChordPad(ctx, dest, barT, comp.barDur * 0.95, key, chord, peak * 0.14);
      }
    }
  }

  function renderOutroBeat(ctx, dest, comp, key, peak, renderOpts) {
    renderOpts = renderOpts || {};
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var start = comp.outroStart >= 0 ? comp.outroStart : comp.totalBars - 12;
    var finaleStart = Math.max(start, comp.totalBars - 8);
    start = Math.max(start, comp.totalBars - 14);
    var bar;
    var chord;
    var barT;
    var beat;
    var fade;

    for (bar = start; bar < comp.totalBars; bar++) {
      if (!barInChunk(comp, bar, renderOpts)) continue;
      chord = comp.progression[bar];
      barT = barLocalTime(comp, bar, renderOpts);
      if (barT >= chunkDur - 0.05) break;
      fade = bar >= comp.totalBars - 3 ? 0.55 + (comp.totalBars - bar) * 0.12 : 1;
      for (beat = 0; beat < 4; beat++) {
        if (bar < finaleStart && beat % 2 === 1) continue;
        playfulTone(
          ctx,
          dest,
          barT + beat * comp.beatDur,
          noteAt(key, chord[beat % 3], bar >= finaleStart ? 3 : 4),
          comp.eighth * 0.85,
          peak * fade * (beat === 0 ? 1.15 : 0.82),
          null,
          beat === 0 ? "triangle" : "sine"
        );
      }
      if (bar >= finaleStart) {
        musicalBell(ctx, dest, barT + comp.beatDur * 3, noteAt(key, chord[1], 4), peak * fade * 0.75);
      }
    }

    bar = comp.totalBars - 1;
    if (bar >= 0 && barInChunk(comp, bar, renderOpts)) {
      chord = comp.progression[bar];
      barT = barLocalTime(comp, bar, renderOpts);
      if (barT < chunkDur - 0.05) {
        musicalBell(ctx, dest, barT, noteAt(key, chord[0], 3), peak * 1.35);
        musicalBell(ctx, dest, barT + comp.beatDur, noteAt(key, chord[2], 4), peak);
        musicalBell(ctx, dest, barT + comp.beatDur * 2, noteAt(key, chord[1], 4), peak * 0.9);
        renderChordPad(ctx, dest, barT, Math.min(comp.barDur * 1.5, chunkDur - barT), key, chord, peak * 0.14);
      }
    }
  }

  function compositionMix(mood) {
    var arch = mood.primaryArchetype || "choir";
    var mix = { pad: 1, arp: 1, mel: 1, beat: 1, sixteenthSkip: 0 };
    if (arch === "water" || arch === "ink") {
      mix.arp = 1.25;
      mix.mel = 0.9;
    } else if (arch === "choir" || arch === "void" || arch === "wind") {
      mix.pad = 1.3;
      mix.arp = 0.72;
      mix.beat = 1.05;
      mix.sixteenthSkip = 1;
    } else if (arch === "pulse" || arch === "earth") {
      mix.beat = 1.35;
      mix.arp = 0.85;
      mix.mel = 0.8;
    } else if (arch === "fire" || arch === "garden" || arch === "crystal") {
      mix.mel = 1.25;
      mix.arp = 1.05;
    }
    if ((mood.density || 1) < 0.75) mix.sixteenthSkip = Math.max(mix.sixteenthSkip, 1);
    if ((mood.density || 1) > 1.2) mix.sixteenthSkip = 0;
    return mix;
  }

  function renderFourFourBeat(ctx, dest, mood, key, comp, renderOpts) {
    renderOpts = renderOpts || {};
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var lift = 0.88 + (mood.clarity || 0.5) * 0.35;
    var layer = compositionMix(mood);
    var base = 0.068 * lift * layer.beat;
    var bar;
    var sec;
    var chord;
    var barT;
    var beat;
    var mul;
    var kick;
    var snare;
    var hat;
    var b;

    for (bar = 0; bar < comp.totalBars; bar++) {
      if (!barInChunk(comp, bar, renderOpts)) continue;
      sec = sectionAt(comp, bar);
      chord = comp.progression[bar];
      barT = barLocalTime(comp, bar, renderOpts);
      if (barT >= chunkDur - 0.02) break;
      beat = comp.beatDur;
      mul = beatSectionMul(sec);
      kick = base * mul * (sec === "chorus" || sec === "hook" ? 1.28 : sec === "intro" ? 0.52 : 1);
      snare = base * mul * (sec === "intro" ? 0.42 : 0.9);
      hat = base * 0.36 * mul;

      playfulTone(ctx, dest, barT, noteAt(key, chord[0], 2), beat * 0.22, kick, null, "triangle");
      playfulTone(ctx, dest, barT, noteAt(key, chord[0], 3), beat * 0.5, kick * 0.6, null, "sine");
      if (sec !== "intro") {
        playfulTone(ctx, dest, barT + beat * 2, noteAt(key, chord[0], 2), beat * 0.18, kick * 0.76, null, "triangle");
      }
      playfulTone(ctx, dest, barT + beat, noteAt(key, chord[2] != null ? chord[2] : chord[1], 4), beat * 0.16, snare, null, "triangle");
      playfulTone(ctx, dest, barT + beat * 3, noteAt(key, chord[2] != null ? chord[2] : chord[1], 4), beat * 0.16, snare, null, "triangle");
      playfulTone(ctx, dest, barT + beat, noteAt(key, chord[1], 6), comp.sixteenth * 2.2, hat, null, "triangle");
      playfulTone(ctx, dest, barT + beat * 3, noteAt(key, chord[0], 6), comp.sixteenth * 2.2, hat * 1.05, null, "triangle");
      if (sec === "hook" || sec === "chorus") {
        for (b = 1; b < 8; b += 2) {
          playfulTone(
            ctx,
            dest,
            barT + b * comp.eighth,
            noteAt(key, chord[b % chord.length], 6),
            comp.sixteenth * 1.9,
            hat * 0.7,
            null,
            "triangle"
          );
        }
      }
    }
  }

  function renderComposition(ctx, dest, mood, key, comp, renderOpts) {
    renderOpts = renderOpts || {};
    var lite = !!renderOpts.lite;
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var lift = 0.88 + (mood.clarity || 0.5) * 0.35;
    var layer = compositionMix(mood);
    var basePad = 0.1 * lift * layer.pad;
    var baseArp = 0.065 * lift * layer.arp;
    var baseMel = 0.08 * lift * layer.mel;
    var baseBeat = 0.055 * lift * layer.beat;
    var bar;
    var s;
    var chord;
    var barT;
    var sec;
    var mul;
    var padOverlap = comp.barDur * 0.08;
    var arpNotes = lite ? 4 : 8;
    var motifStep = lite ? 4 : 2;
    var padStep = lite ? 2 : 1;

    if (!lite) renderIntroLift(ctx, dest, comp, key, lift * 0.12, renderOpts);

    for (bar = 0; bar < comp.totalBars; bar += padStep) {
      if (!barInChunk(comp, bar, renderOpts)) continue;
      barT = barLocalTime(comp, bar, renderOpts);
      if (barT >= chunkDur - 0.05) break;
      sec = sectionAt(comp, bar);
      if (sec === "intro") continue;
      mul = sectionMul(sec, "pad");
      chord = comp.progression[bar];
      var padDur = Math.min(comp.barDur + padOverlap, chunkDur - barT);
      renderChordPad(ctx, dest, barT, padDur, key, chord, basePad * mul.pad);
    }

    for (bar = 0; bar < comp.totalBars; bar++) {
      if (!barInChunk(comp, bar, renderOpts)) continue;
      sec = sectionAt(comp, bar);
      if (sec !== "chorus" && sec !== "hook") continue;
      if (lite && bar % 2 === 1) continue;
      mul = sectionMul(sec, "arp");
      chord = comp.progression[bar];
      barT = barLocalTime(comp, bar, renderOpts);
      for (s = 0; s < arpNotes; s++) {
        if ((layer.sixteenthSkip || mul.skip) && s % 2 === 1) continue;
        var st = barT + s * comp.eighth;
        if (st < -0.02 || st >= chunkDur - 0.02) break;
        var deg = chord[s % chord.length];
        playfulTone(ctx, dest, st, noteAt(key, deg, 3 + (s % 2)), comp.eighth * 0.82, baseArp * mul.arp, null, "triangle");
      }
    }

    for (bar = 0; bar < comp.totalBars; bar += motifStep) {
      if (!barInChunk(comp, bar, renderOpts)) continue;
      sec = sectionAt(comp, bar);
      if (sec === "hook" || sec === "chorus" || sec === "intro" || sec === "outro") continue;
      mul = sectionMul(sec, "mel");
      chord = comp.progression[bar];
      renderMotifOnGrid(ctx, dest, comp, bar, key, chord, baseMel * mul.mel, Math.floor(bar / 2), renderOpts);
    }

    if (!lite) {
      for (bar = 0; bar < comp.totalBars; bar++) {
        if (!barInChunk(comp, bar, renderOpts)) continue;
        sec = sectionAt(comp, bar);
        if (sec === "hook" && bar % 2 === 0) {
          renderHookLine(ctx, dest, comp, bar, key, baseMel * 1.35, renderOpts);
          bar++;
          continue;
        }
        if (sec === "chorus") {
          renderChorusLine(ctx, dest, comp, bar, key, baseMel * 1.2, renderOpts);
        }
      }
    }

    if (lite) {
      renderFourFourBeat(ctx, dest, mood, key, comp, renderOpts);
    } else {
      for (bar = 0; bar < comp.totalBars; bar++) {
        if (!barInChunk(comp, bar, renderOpts)) continue;
        sec = sectionAt(comp, bar);
        if (sec === "outro") continue;
        mul = sectionMul(sec, "beat");
        chord = comp.progression[bar];
        barT = barLocalTime(comp, bar, renderOpts);
        if (sec === "verse" || sec === "bridge") {
          if (bar % 2 === 1) continue;
        }
        musicalBell(ctx, dest, barT, noteAt(key, chord[0], 3), baseBeat * mul.beat * 1.15);
        musicalBell(ctx, dest, barT + comp.beatDur * 2, noteAt(key, chord[1], 3), baseBeat * mul.beat);
      }
      renderOutroBeat(ctx, dest, comp, key, baseBeat * 1.1, renderOpts);
    }
  }

  function renderMusicalFoundation(ctx, dest, mood, duration, key, comp, renderOpts) {
    renderComposition(ctx, dest, mood, key, comp, renderOpts);
  }

  function firstSectionBar(comp, type, after) {
    var bar;
    after = after == null ? 0 : after;
    for (bar = after; bar < comp.totalBars; bar++) {
      if (sectionAt(comp, bar) === type) return bar;
    }
    return after;
  }

  function renderSpellSignature(ctx, dest, spell, index, comp, baseKey, peak, renderOpts) {
    renderOpts = renderOpts || {};
    var chunkDur = renderOpts.chunkDur != null ? renderOpts.chunkDur : comp.duration;
    var sk = spellKey(spell, index, baseKey);
    var arch = resolveArchetype(spell);
    var timbre = spellTimbre(arch);
    var shape = MELODY_SHAPES[(spell.paintingNum + index * 2) % MELODY_SHAPES.length];
    var bar = firstSectionBar(comp, "chorus", index * 2);
    if (!barInChunk(comp, bar, renderOpts)) return;
    var chord = comp.progression[bar % comp.totalBars];
    var i;
    var t;
    var deg;
    for (i = 0; i < shape.length; i++) {
      t = barLocalTime(comp, bar, renderOpts) + i * comp.eighth;
      if (t < -0.02 || t >= chunkDur - 0.02) break;
      deg = chord[shape[i] % chord.length];
      playfulTone(
        ctx,
        dest,
        t,
        noteAt(sk, deg, timbre.octave + (i % 2)),
        comp.eighth * 0.8,
        peak * timbre.bright,
        null,
        timbre.wave
      );
    }
    musicalBell(ctx, dest, barLocalTime(comp, bar, renderOpts), noteAt(sk, chord[0], timbre.octave), peak * 0.85);
  }

  function createOfflineContext(duration) {
    var length = Math.ceil(RENDER_SAMPLE_RATE * duration);
    try {
      return new OfflineAudioContext({
        numberOfChannels: 6,
        length: length,
        sampleRate: RENDER_SAMPLE_RATE,
      });
    } catch (e1) {
      return new OfflineAudioContext(6, length, RENDER_SAMPLE_RATE);
    }
  }

  function createStemBuses(ctx) {
    var melodyBus = ctx.createGain();
    melodyBus.gain.value = 1;
    var colorsBus = ctx.createGain();
    colorsBus.gain.value = 1;
    var spellsBus = ctx.createGain();
    spellsBus.gain.value = 1;
    var merger = ctx.createChannelMerger(6);
    melodyBus.connect(merger, 0, 0);
    melodyBus.connect(merger, 0, 1);
    colorsBus.connect(merger, 0, 2);
    colorsBus.connect(merger, 0, 3);
    spellsBus.connect(merger, 0, 4);
    spellsBus.connect(merger, 0, 5);
    merger.connect(ctx.destination);
    return { melody: melodyBus, colors: colorsBus, spells: spellsBus, merger: merger };
  }

  function buildAudioGraphAsync(ctx, buses, spells, mood, duration, key, composition, isPreview, renderOpts) {
    return new Promise(function (resolve, reject) {
      var prepStart = Date.now();
      var spellIdx = 0;
      var spellCap = renderOpts.lite ? Math.min(spells.length, 6) : spells.length;

      function timedOut() {
        return Date.now() - prepStart > COMPOSE_PREP_TIMEOUT_MS;
      }

      function setPrepStep(step) {
        if (state.composeProgress) state.composeProgress.prepStep = step;
        tickComposeProgress();
      }

      function next(fn) {
        requestAnimationFrame(function () {
          setTimeout(fn, 0);
        });
      }

      function fail() {
        reject(new Error("prep-timeout"));
      }

      setPrepStep("foundation");
      next(function () {
        if (timedOut()) {
          fail();
          return;
        }
        renderMusicalFoundation(ctx, buses.melody, mood, duration, key, composition, renderOpts);
        setPrepStep("scene");
        next(function () {
          if (timedOut()) {
            fail();
            return;
          }
          renderPromptSfx(ctx, buses.colors, mood, composition, key, renderOpts);
          if (isPreview) {
            resolve();
            return;
          }
          function renderSpells() {
            if (timedOut()) {
              fail();
              return;
            }
            if (spellIdx >= spellCap) {
              resolve();
              return;
            }
            setPrepStep("spell-" + (spellIdx + 1));
            next(function () {
              renderSpellMelody(
                ctx,
                buses.spells,
                spells[spellIdx],
                spellIdx,
                spellCap,
                duration,
                key,
                composition,
                renderOpts
              );
              spellIdx++;
              renderSpells();
            });
          }
          renderSpells();
        });
      });
    });
  }

  function startOfflineRender(ctx, showProgress) {
    return new Promise(function (resolve, reject) {
      requestAnimationFrame(function () {
        setTimeout(function () {
          if (showProgress) markComposeRenderingStart();
          ctx.startRendering().then(resolve).catch(reject);
        }, 0);
      });
    });
  }

  function synthesizeMinimalStems(spells, duration, showProgress) {
    duration = duration || INSTANT_DURATION;
    var analyzed = analyzeListeningPrompt(getEarsPrompt());
    var mood = getBakeMood(analyzed, spells);
    state.promptMood = mood;
    var key = promptToKey(mood, spells);
    var composition = buildComposition(mood, duration, key);
    var ctx = createOfflineContext(duration);
    var buses = createStemBuses(ctx);
    var bar;
    var chord;
    var barT;

    for (bar = 0; bar < composition.totalBars; bar++) {
      chord = composition.progression[bar];
      barT = bar * composition.barDur;
      if (barT >= duration - 0.05) break;
      renderChordPad(ctx, buses.melody, barT, composition.barDur * 0.88, key, chord, 0.11);
      if (bar % 2 === 0) {
        musicalBell(ctx, buses.melody, barT, noteAt(key, chord[0], 4), 0.075);
      }
    }

    return startOfflineRender(ctx, !!showProgress).then(splitStemBuffer);
  }

  function renderSpellMelody(ctx, dest, spell, index, total, duration, key, comp, renderOpts) {
    renderOpts = renderOpts || {};
    var lite = !!renderOpts.lite;
    var arch = resolveArchetype(spell);
    var timbre = spellTimbre(arch);
    var sk = spellKey(spell, index, key);
    var g = (0.14 + index * 0.018) / Math.sqrt(Math.max(1, total * 0.65));
    var bar;
    var sec;
    var chord;
    var step = Math.max(2, 5 - (total > 4 ? 1 : 0));
    if (lite) step = Math.max(step, 4);

    if (!lite) renderSpellSignature(ctx, dest, spell, index, comp, key, g * 1.35, renderOpts);

    for (bar = index; bar < comp.totalBars; bar += step + (index % 2)) {
      if (!barInChunk(comp, bar, renderOpts)) continue;
      sec = sectionAt(comp, bar);
      if (sec === "intro" || sec === "verse" || sec === "bridge" || sec === "outro") continue;
      chord = comp.progression[bar];
      var mul = sec === "chorus" ? 1.45 : sec === "hook" ? 1.2 : sec === "bridge" ? 0.75 : 1;
      renderArpeggioOnGrid(ctx, dest, comp, bar, sk, chord, g * mul * timbre.bright, bar + index * 3, renderOpts);
      if (!lite && (sec === "chorus" || sec === "hook")) {
        renderMotifOnGrid(ctx, dest, comp, bar, sk, chord, g * 1.15 * mul, index + bar + spell.paintingNum, renderOpts);
      }
      if (!lite && arch === "crystal" && sec === "chorus" && bar % 4 === index % 4) {
        musicalBell(ctx, dest, barLocalTime(comp, bar, renderOpts), noteAt(sk, chord[1], timbre.octave + 1), g * 1.1);
      }
    }
  }

  function synthesizeStems(spells, duration, progressLabel, opts) {
    opts = opts || {};
    duration = duration == null ? SOUND_DURATION : duration;
    var fullDuration = opts.fullDuration || duration;
    var isPreview = duration <= PREVIEW_DURATION + 2 && !opts.fullDuration;
    var analyzed = analyzeListeningPrompt(getEarsPrompt());
    var mood = getBakeMood(analyzed, spells);
    state.promptMood = mood;
    var key = promptToKey(mood, spells);
    var composition = buildComposition(mood, fullDuration, key);
    var renderOpts = {
      lite: opts.lite != null ? opts.lite : isPreview || duration >= 60,
      chunkOffset: opts.chunkOffset || 0,
      chunkDur: duration,
    };
    var estMs = estimateRenderMs(duration, spells.length, isPreview);
    var label =
      progressLabel ||
      (isPreview
        ? "Composing preview from your prompt"
        : opts.chunkTotal > 1
          ? "Extending track (" + ((opts.chunkIndex || 0) + 1) + "/" + opts.chunkTotal + ")"
          : "Composing full ~3:00 track");
    if (!opts.silentProgress) {
      startComposeProgress(label, estMs, false);
      if (state.composeProgress) state.composeProgress.durationSec = duration;
    }

    var ctx = createOfflineContext(duration);
    var buses = createStemBuses(ctx);

    return buildAudioGraphAsync(ctx, buses, spells, mood, duration, key, composition, isPreview, renderOpts)
      .then(function () {
        return startOfflineRender(ctx, !opts.silentProgress);
      })
      .then(splitStemBuffer)
      .then(function (stems) {
        if (!opts.silentProgress) {
          var readyMsg = isPreview ? "Preview audio ready" : "Full track audio ready";
          markComposeBuffersReady(readyMsg);
        }
        return stems;
      })
      .catch(function (err) {
        if (!opts.silentProgress) cancelComposeProgress(true);
        throw err;
      });
  }

  function synthesizeFullChunked(spells, duration, genId) {
    var chunkSec = FULL_CHUNK_SEC;
    var chunks = Math.ceil(duration / chunkSec);
    var parts = [];
    var i = 0;

    function renderChunk() {
      if (genId !== state.composeGen) return Promise.resolve(null);
      if (i >= chunks) return Promise.resolve(concatStemBuffers(parts));
      var offset = i * chunkSec;
      var chunkDur = Math.min(chunkSec, duration - offset);
      return synthesizeStems(spells, chunkDur, null, {
        silentProgress: true,
        lite: true,
        chunkOffset: offset,
        fullDuration: duration,
        chunkIndex: i,
        chunkTotal: chunks,
      }).then(function (stems) {
        if (!stems) return null;
        parts.push(stems);
        i++;
        return renderChunk();
      });
    }

    return renderChunk();
  }

  function hotSwapStems(stems, genId) {
    if (genId !== state.composeGen) return Promise.resolve();
    var wasPlaying = state.playing;
    var head = wasPlaying ? getPlayhead() : state.playhead;
    state.livePlayback = false;
    state.stems = stems;
    state.buffer = stems.melody;
    state.playhead = Math.min(head, bufferDuration());
    applyLiveMix();
    updateTransport();
    if (!wasPlaying) return Promise.resolve();
    return startPlaybackAt(state.playhead).then(function () {
      setStatus("Richer mix ready — keeps playing toward full ~3:00.", "ok");
    });
  }

  function initBars() {
    var eq = $("ea-eq");
    if (!eq) return;
    if (state.barCols.length && state.barCols[0].up) return;
    if (state.barCols.length) {
      eq.innerHTML = "";
      state.barCols = [];
    }
    eq.innerHTML = "";
    state.barCols = [];
    for (var i = 0; i < BAR_COUNT; i++) {
      var col = document.createElement("div");
      col.className = "ea-bar-col";
      col.setAttribute("aria-hidden", "true");
      var up = document.createElement("div");
      up.className = "ea-bar-up";
      var down = document.createElement("div");
      down.className = "ea-bar-down";
      col.appendChild(up);
      col.appendChild(down);
      eq.appendChild(col);
      state.barCols.push({ col: col, up: up, down: down });
    }
    layoutBarVisionSlices();
  }

  function setBarHeights(values, active) {
    var cols = state.barCols;
    if (!cols.length) return;
    var n = cols.length;
    var sampled = [];
    var maxV = 1;
    var i;
    var v;
    var pct;
    var half;
    for (i = 0; i < n; i++) {
      v = active ? sampleBarSpectrum(values, i, n) : 0;
      sampled.push(v);
      if (v > maxV) maxV = v;
    }
    for (i = 0; i < n; i++) {
      if (active) {
        v = sampled[i] / maxV;
        pct = Math.max(8, Math.pow(v, 0.82) * 100);
      } else {
        pct = 6 + (i % 4) * 2;
      }
      half = pct * 0.5 + "%";
      cols[i].up.style.height = half;
      cols[i].down.style.height = half;
    }
    updateScanline();
  }

  function tickFrame() {
    if (state.playing && state.analyser && state.freqData) {
      state.analyser.getByteFrequencyData(state.freqData);
      setBarHeights(state.freqData, true);
      updateTransport();
    }
    if (state.scoreEdit && state.scoreEdit.visible) {
      renderScoreRoll();
    }
    if (state.playing) {
      state.rafId = requestAnimationFrame(tickFrame);
    }
  }

  function startVisualizer() {
    stopVisualizer();
    var stage = $("ea-stage");
    if (stage) stage.classList.add("ea-playing");
    state.rafId = requestAnimationFrame(tickFrame);
  }

  function stopVisualizer() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    var stage = $("ea-stage");
    if (stage) stage.classList.remove("ea-playing");
    setBarHeights(state.freqData || new Uint8Array(BAR_COUNT), false);
    updateScanline();
  }

  function stopLiveScoreScheduler() {
    if (state.liveScheduleTimer) {
      clearTimeout(state.liveScheduleTimer);
      state.liveScheduleTimer = 0;
    }
  }

  function resetMasterGainVolume() {
    if (!state.masterGain || !state.audioCtx) return;
    var now = state.audioCtx.currentTime;
    var vol = Math.max(0.05, getTweaks().volume || 1);
    state.masterGain.gain.cancelScheduledValues(now);
    state.masterGain.gain.setValueAtTime(vol, now);
  }

  function disconnectSources() {
    stopLiveScoreScheduler();
    if (state.liveEndTimer) {
      clearTimeout(state.liveEndTimer);
      state.liveEndTimer = 0;
    }
    state.sources.forEach(function (src) {
      try {
        src.stop();
      } catch (e) {}
      src.onended = null;
      src.disconnect();
    });
    state.sources = [];
    if (state.source) {
      try {
        state.source.stop();
      } catch (e) {}
      state.source.onended = null;
      state.source.disconnect();
      state.source = null;
    }
  }

  function beatSectionMul(sec) {
    var m = sectionMul(sec, "beat");
    return m.beat;
  }

  function scoreFourFourBeat(push, composition, duration, mood, key, lift) {
    var bar;
    var sec;
    var prevSec;
    var chord;
    var barT;
    var beat = composition.beatDur;
    var eighth = composition.eighth;
    var sixteenth = composition.sixteenth;
    var mul;
    var kick;
    var snare;
    var hat;
    var b;
    var introBars;
    var introBar;
    var layer = compositionMix(mood);
    var base = 0.112 * lift * layer.beat;

    for (bar = 0; bar < composition.totalBars; bar++) {
      sec = sectionAt(composition, bar);
      prevSec = bar > 0 ? sectionAt(composition, bar - 1) : "";
      chord = composition.progression[bar];
      barT = bar * composition.barDur;
      if (barT >= duration - 0.02) break;
      mul = beatSectionMul(sec);
      introBars = sec === "intro" ? countSectionBars(composition, "intro") : 0;
      introBar = sec === "intro" ? bar : 0;
      kick = base * mul * (sec === "chorus" || sec === "hook" ? 1.55 : sec === "outro" ? 0.92 : 1);
      snare = base * mul * (sec === "chorus" || sec === "hook" ? 1.22 : sec === "outro" ? 0.55 : 1);
      hat = base * 0.52 * mul;

      if (sec === "intro") {
        kick *= 0.4 + (introBar / Math.max(1, introBars - 1)) * 0.6;
        snare *= Math.max(0.15, kick / base - 0.25);
        hat *= Math.max(0.1, kick / base - 0.35);
      }

      push("beat", barT, noteAt(key, chord[0], BASS_OCTAVE), beat * 0.22, kick, null, { kind: "kick" });
      if (sec !== "intro" || introBar > 0) {
        push("beat", barT, noteAt(key, chord[0], BASS_OCTAVE), beat * 1.32, kick * 0.82, null, { kind: "bass" });
        if (sec !== "intro" && sec !== "outro") {
          push("beat", barT + beat, noteAt(key, chord[1] != null ? chord[1] : chord[0], BASS_OCTAVE), beat * 1.18, kick * 0.52, null, { kind: "bass" });
          push("beat", barT + beat * 3, noteAt(key, chord[0], BASS_OCTAVE), beat * 1.18, kick * 0.48, null, { kind: "bass" });
        }
      }

      if (sec !== "intro" && sec !== "outro") {
        push("beat", barT + beat * 2, noteAt(key, chord[0], 2), beat * 0.18, kick * 0.82, null, { kind: "kick" });
      } else if (sec === "intro" && introBar >= introBars - 1) {
        push("beat", barT + beat * 2, noteAt(key, chord[0], 2), beat * 0.16, kick * 0.68, null, { kind: "kick" });
      }

      if (sec !== "intro" || introBar >= introBars - 1) {
        push("beat", barT + beat, beatPercFreq("snare", key, chord), beat * 0.15, snare, null, { kind: "snare" });
        push("beat", barT + beat * 3, beatPercFreq("snare", key, chord), beat * 0.15, snare * 1.02, null, { kind: "snare" });
      }

      if (sec !== "intro") {
        push("beat", barT + beat, beatPercFreq("snap", key, chord), sixteenth * 2.2, snare * 0.28, null, { kind: "snap" });
      }

      if (sec !== "intro" || introBar > 0) {
        for (b = 0; b < 8; b++) {
          push(
            "beat",
            barT + b * eighth,
            beatPercFreq("hat", key, chord),
            sixteenth * 2.2,
            hat * (b % 2 === 0 ? 0.72 : sec === "verse" || sec === "bridge" ? 0.48 : 0.58),
            null,
            { kind: "hat" }
          );
        }
      } else if (introBar >= introBars - 1) {
        for (b = 0; b < 4; b++) {
          push("beat", barT + b * eighth * 2, beatPercFreq("hat", key, chord), sixteenth * 2, hat * 0.38, null, { kind: "hat" });
        }
      }

      if (sec === "outro") {
        if (bar % 2 === 0) {
          push("beat", barT + beat * 2, noteAt(key, chord[0], 2), beat * 0.14, kick * 0.55, null, { kind: "kick" });
        }
        push("beat", barT + beat * 3, beatPercFreq("hat", key, chord), sixteenth * 2.2, hat * 0.35, null, { kind: "hat" });
      }
    }
  }

  function scoreIntroToHook(push, composition, duration, mood, key, lift) {
    var introBars = countSectionBars(composition, "intro");
    var bar;
    var barT;
    var chord;
    var shape;
    var i;
    var deg;
    var freq;
    var hookTimbre;

    if (introBars < 1) return;
    for (bar = 0; bar < introBars; bar++) {
      chord = composition.progression[bar];
      barT = bar * composition.barDur;
      if (barT >= duration - 0.02) break;
      if (bar < introBars - 1) {
        var pat = ARPEGGIO_PATTERNS[bar % ARPEGGIO_PATTERNS.length];
        var ai;
        for (ai = 0; ai < 4; ai++) {
          push(
            "colors",
            barT + ai * composition.eighth,
            noteAt(key, chord[pat[ai % pat.length] % chord.length], MELODY_OCTAVE),
            composition.eighth * 1.2,
            0.028 * lift,
            "sine",
            { kind: "arp", filterHz: 3200 }
          );
        }
        continue;
      }
      shape = HOOK_SHAPES[composition.hookIdx];
      hookTimbre = archetypeMelodyTimbre(mood, 0);
      for (i = Math.max(0, shape.length - 4); i < shape.length; i++) {
        deg = chord[shape[i] % chord.length];
        freq = noteAt(key, deg, MELODY_OCTAVE + (i === shape.length - 1 ? 1 : 0));
        push("melody", barT + i * composition.eighth, freq, composition.eighth * 1.45, 0.1 * lift, "sine", {
          kind: "melody",
          harmonic: false,
          filterHz: 4400,
          detune: 0,
        });
      }
    }
  }

  function scoreHookLines(push, composition, duration, mood, key, lift) {
    var shape = HOOK_SHAPES[composition.hookIdx];
    var bar;
    var sec;
    var chord;
    var barT;
    var i;
    var deg;
    var freq;
    var hookTimbre;

    for (bar = 0; bar < composition.totalBars; bar++) {
      sec = sectionAt(composition, bar);
      if (sec !== "hook") continue;
      chord = composition.progression[bar];
      barT = bar * composition.barDur;
      if (barT >= duration - 0.02) break;
      for (i = 0; i < shape.length; i++) {
        deg = chord[shape[i] % chord.length];
        hookTimbre = archetypeMelodyTimbre(mood, bar + i);
        freq = noteAt(key, deg, MELODY_OCTAVE + (i % 2));
        push("melody", barT + i * composition.eighth, freq, composition.eighth * 1.48, 0.095 * lift, "sine", {
          kind: "melody",
          harmonic: i === shape.length - 1,
          filterHz: 4200,
          detune: 0,
          harmonicMix: 0.16,
        });
      }
    }
  }

  function scoreChorusLines(push, composition, duration, mood, key, lift) {
    var shape = CHORUS_SHAPES[composition.chorusIdx];
    var bar;
    var sec;
    var chord;
    var barT;
    var i;
    var deg;
    var freq;
    var chorusTimbre;

    for (bar = 0; bar < composition.totalBars; bar++) {
      sec = sectionAt(composition, bar);
      if (sec !== "chorus") continue;
      chord = composition.progression[bar];
      barT = bar * composition.barDur;
      if (barT >= duration - 0.02) break;
      for (i = 0; i < shape.length; i++) {
        deg = chord[shape[i] % chord.length];
        chorusTimbre = archetypeMelodyTimbre(mood, bar + i);
        freq = noteAt(key, deg, MELODY_OCTAVE + 1 + (i % 2));
        push("melody", barT + i * composition.eighth, freq, composition.eighth * 1.5, 0.1 * lift, "sine", {
          kind: "melody",
          harmonic: i === shape.length - 1,
          filterHz: 4500,
          detune: 0,
          harmonicMix: 0.18,
        });
      }
      push("melody", barT + composition.beatDur * 3 + composition.eighth, noteAt(key, chord[1], MELODY_OCTAVE), composition.eighth * 1.35, 0.08 * lift, "sine", {
        kind: "fill",
        harmonic: false,
      });
    }
  }

  function scoreOutroTail(push, composition, duration, mood, key, lift) {
    var outroStart = composition.outroStart >= 0 ? composition.outroStart : Math.max(0, composition.totalBars - 2);
    var bar;
    var sec;
    var chord;
    var barT;
    var fade;
    var outroLen;

    outroLen = Math.max(1, composition.totalBars - outroStart);
    for (bar = outroStart; bar < composition.totalBars; bar++) {
      sec = sectionAt(composition, bar);
      if (sec !== "outro") continue;
      chord = composition.progression[bar];
      barT = bar * composition.barDur;
      if (barT >= duration - 0.02) break;
      fade = 1 - ((bar - outroStart) / outroLen) * 0.75;
      push("melody", barT + composition.beatDur * 3, noteAt(key, chord[0], MELODY_OCTAVE), composition.eighth * 1.4, 0.07 * lift * fade, "sine", {
        kind: "melody",
        harmonic: false,
      });
      if (bar === composition.totalBars - 1) {
        push("melody", barT, noteAt(key, chord[0], MELODY_OCTAVE), composition.barDur * 0.95, 0.04 * lift * fade, "sine", {
          kind: "pad",
        });
      }
    }
  }

  function trimScoreNotes(notes, max) {
    if (notes.length <= max) return notes;
    function priority(n) {
      var k = n.kind || "note";
      if (k === "melody" || k === "fill" || k === "bell" || k === "pad") return 6;
      if (k === "arp" || k === "accent" || k === "spark" || k === "scene" || k === "voice") return 5;
      if (k === "kick" || k === "snare" || k === "bass") return 4;
      if (k === "hat" || k === "snap") return 3;
      return 1;
    }
    return notes
      .slice()
      .sort(function (a, b) {
        return priority(b) - priority(a) || a.t - b.t;
      })
      .slice(0, max)
      .sort(function (a, b) {
        return a.t - b.t;
      });
  }

  function scoreChordPads(push, composition, duration, mood, key, lift) {
    var bar;
    var sec;
    var chord;
    var barT;
    var deg;
    var mul;
    var overlap = composition.barDur * 1.15;
    for (bar = 0; bar < composition.totalBars; bar++) {
      sec = sectionAt(composition, bar);
      chord = composition.progression[bar];
      barT = bar * composition.barDur;
      if (barT >= duration - 0.02) break;
      mul = sec === "chorus" ? 1.1 : sec === "hook" ? 1.0 : sec === "intro" ? 0.45 : sec === "outro" ? 0.65 : 0.85;
      push("melody", barT, noteAt(key, chord[0], BASS_OCTAVE), overlap, 0.018 * lift * mul, "sine", {
        kind: "pad",
        filterHz: 320,
        filterQ: 0.25,
      });
      push("melody", barT, noteAt(key, chord[2] != null ? chord[2] : chord[1], 3), overlap * 0.98, 0.014 * lift * mul, "sine", {
        kind: "pad",
        filterHz: 420,
        filterQ: 0.3,
      });
    }
  }

  function scoreArpeggioBed(push, composition, duration, mood, key, lift) {
    var bar;
    var sec;
    var chord;
    var barT;
    var pat;
    var i;
    var deg;
    var density;
    for (bar = 0; bar < composition.totalBars; bar++) {
      sec = sectionAt(composition, bar);
      if (sec === "outro") continue;
      chord = composition.progression[bar];
      barT = bar * composition.barDur;
      if (barT >= duration - 0.02) break;
      pat = ARPEGGIO_PATTERNS[bar % ARPEGGIO_PATTERNS.length];
      density = sec === "intro" ? 4 : sec === "hook" || sec === "chorus" ? 4 : sec === "verse" || sec === "bridge" ? 5 : 6;
      for (i = 0; i < density; i++) {
        deg = chord[pat[i % pat.length] % chord.length];
        push("colors", barT + i * composition.eighth, noteAt(key, deg, MELODY_OCTAVE), composition.eighth * 1.18, 0.028 * lift, "sine", {
          kind: "arp",
          filterHz: 3400,
        });
      }
    }
  }

  function buildMelodyScore(spells, duration, mood, key, composition) {
    var notes = [];
    var lift = 0.88 + (mood.clarity || 0.5) * 0.35;
    var bar;
    var chord;
    var barT;
    var sec;
    var i;
    var deg;
    var shape;
    var map;
    var wi;
    var entry;
    var si;
    var spell;
    var sk;

    function push(stem, t, freq, dur, peak, wave, opts) {
      opts = opts || {};
      if (t < 0 || t >= duration - 0.01 || !isFinite(freq) || freq < 20) return;
      var kind = opts.kind || "note";
      var bar = Math.floor(t / composition.barDur);
      var sec = sectionAt(composition, bar);
      var timbre = mergeNoteTimbre(kind, opts);
      if (wave) timbre.wave = wave;
      peak *= sectionPeakMul(composition, bar, sec, kind);
      notes.push({
        stem: stem || "melody",
        t: t,
        freq: freq,
        dur: dur,
        peak: peak,
        wave: timbre.wave || "triangle",
        kind: kind,
        harmonic: !!opts.harmonic || !!timbre.harmonic,
        slideTo: opts.slideTo || timbre.slideTo || 0,
        detune: timbre.detune || 0,
        filterHz: timbre.filterHz || 0,
        filterQ: timbre.filterQ != null ? timbre.filterQ : 1,
        filterType: timbre.filterType || "lowpass",
        harmonicRatio: timbre.harmonicRatio || 2,
        harmonicMix: timbre.harmonicMix != null ? timbre.harmonicMix : 0.42,
        noiseMix: timbre.noiseMix || 0,
        noiseFilter: timbre.noiseFilter || 1200,
        noiseQ: timbre.noiseQ != null ? timbre.noiseQ : 1.1,
      });
    }

    scoreFourFourBeat(push, composition, duration, mood, key, lift);
    scoreChordPads(push, composition, duration, mood, key, lift);
    scoreArpeggioBed(push, composition, duration, mood, key, lift);
    scoreIntroToHook(push, composition, duration, mood, key, lift);
    scoreHookLines(push, composition, duration, mood, key, lift);
    scoreChorusLines(push, composition, duration, mood, key, lift);
    scoreOutroTail(push, composition, duration, mood, key, lift);

    for (bar = 0; bar < composition.totalBars; bar++) {
      sec = sectionAt(composition, bar);
      if (sec === "hook" || sec === "chorus" || sec === "intro" || sec === "outro") continue;
      chord = composition.progression[bar];
      barT = bar * composition.barDur;
      if (barT >= duration - 0.02) break;
      shape = MELODY_SHAPES[bar % MELODY_SHAPES.length];
      for (i = 0; i < shape.length; i++) {
        deg = chord[shape[i] % chord.length];
        var verseTimbre = archetypeMelodyTimbre(mood, bar + i);
        push("melody", barT + i * composition.eighth, noteAt(key, deg, MELODY_OCTAVE), composition.eighth * 1.45, 0.072 * lift, "sine", {
          kind: "melody",
          filterHz: 4000,
          detune: 0,
          harmonic: i === shape.length - 1,
          harmonicMix: 0.14,
        });
      }
    }

    map = (mood.wordSceneMap || []).slice(0, 6);
    for (wi = 0; wi < map.length; wi++) {
      entry = map[wi];
      var sceneTone = sceneTimbre(entry.type);
      for (bar = entry.barOffset; bar < composition.totalBars; bar += Math.max(1, entry.step)) {
        sec = sectionAt(composition, bar);
        if (sec === "outro") continue;
        chord = composition.progression[bar];
        barT = bar * composition.barDur;
        if (barT >= duration - 0.02) break;
        for (i = 0; i < (sec === "intro" ? 3 : 4); i++) {
          push(
            "colors",
            barT + i * composition.eighth,
            noteAt(key, chord[(wi + i) % chord.length], MELODY_OCTAVE),
            composition.eighth * 1.12,
            0.026 * entry.weight * (sec === "intro" ? 0.55 : sec === "verse" ? 0.75 : 1),
            "sine",
            {
              kind: sceneTone.kind || "scene",
              filterHz: sceneTone.filterHz,
              detune: 0,
              harmonic: false,
              noiseMix: sceneTone.noiseMix * 0.85,
              noiseFilter: sceneTone.noiseFilter,
            }
          );
        }
      }
    }

    for (si = 0; si < Math.min(4, spells.length); si++) {
      spell = spells[si];
      sk = spellKey(spell, si, key);
      var spellTone = spellTimbre(resolveArchetype(spell));
      for (bar = si; bar < composition.totalBars; bar += 2) {
        sec = sectionAt(composition, bar);
        if (sec !== "chorus" && sec !== "hook" && sec !== "verse" && sec !== "bridge") continue;
        chord = composition.progression[bar];
        barT = bar * composition.barDur;
        if (barT >= duration - 0.02) break;
        push("spells", barT, noteAt(key, chord[0], MELODY_OCTAVE + 1), composition.eighth * 1.1, 0.032, "sine", {
          kind: "accent",
          filterHz: 3800,
          detune: 0,
          harmonicMix: 0.1,
        });
        push("spells", barT + composition.eighth * 2, noteAt(key, chord[1], MELODY_OCTAVE + 1), composition.eighth * 1.08, 0.028, "sine", {
          kind: "accent",
          filterHz: 4000,
          detune: 0,
          harmonic: false,
        });
      }
    }

    notes.sort(function (a, b) {
      return a.t - b.t;
    });
    notes = applyLegato(notes);
    notes = trimScoreNotes(notes, SCORE_NOTE_CAP);
    return { duration: duration, notes: notes, mood: mood, key: key, composition: composition };
  }

  function emitScoreNote(ctx, dest, when, note, opts) {
    opts = opts || {};
    var rate = opts.rate || 1;
    var track = opts.trackSources !== false;
    var dur = note.dur / rate;
    var kind = note.kind || "note";
    var attack =
      kind === "kick"
        ? 0.004
        : kind === "hat" || kind === "snap"
          ? 0.003
          : kind === "snare"
            ? 0.006
            : kind === "pad"
              ? 0.12
              : kind === "arp"
                ? 0.014
                : kind === "bass"
                  ? 0.012
                  : 0.016;
    var live = !!opts.live;
    var release =
      kind === "kick"
        ? dur * 0.52
        : kind === "hat"
          ? dur * 0.75
          : kind === "pad"
            ? live ? Math.min(dur * 1.08, 2.8) : dur * 1.14
            : kind === "melody" || kind === "fill"
              ? live
                ? dur + 0.14
                : dur + 0.22
              : kind === "arp" || kind === "bell"
                ? live
                  ? dur + 0.1
                  : dur + 0.16
                : kind === "bass"
                  ? live
                    ? dur + 0.08
                    : dur + 0.12
                  : dur * 0.9;
    release = Math.max(release, attack + 0.02);
    var peak = note.peak;
    var filterHz = note.filterHz || (kind === "melody" || kind === "pad" || kind === "arp" ? 3200 : 0);
    var filterQ = note.filterQ != null ? note.filterQ : 1;
    var filterType = note.filterType || "lowpass";
    var detune = note.detune || 0;
    var noiseMix = note.noiseMix || 0;
    var harmonicMix = note.harmonicMix != null ? note.harmonicMix : 0.38;
    var harmonicRatio = note.harmonicRatio || 2;
    var tonalMul = noiseMix > 0.01 ? Math.max(0.4, 1 - noiseMix * 0.5) : 1;
    var sources = opts.sources || (track ? state.sources : null);

    function makeOutput() {
      if (filterHz > 20) {
        var filt = ctx.createBiquadFilter();
        filt.type = filterType;
        filt.frequency.value = filterHz;
        filt.Q.value = filterQ;
        filt.connect(dest);
        return filt;
      }
      return dest;
    }

    function trackNode(node) {
      if (sources && node) sources.push(node);
    }

    function spawnOsc(freq, peakMul, wave, cents, slideMul) {
      var out = makeOutput();
      var osc = ctx.createOscillator();
      osc.type = wave || note.wave || "triangle";
      osc.detune.value = cents != null ? cents : detune;
      osc.frequency.setValueAtTime(freq, when);
      var slideTarget = note.slideTo;
      if (slideTarget && slideTarget > 0) {
        if (slideTarget < 4) slideTarget = freq * slideTarget;
        osc.frequency.exponentialRampToValueAtTime(slideTarget, when + Math.min(dur * (slideMul || 0.5), 0.2));
      }
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(peak * peakMul * tonalMul, 0.0001), when + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, when + release);
      osc.connect(g);
      g.connect(out);
      osc.start(when);
      osc.stop(when + release + 0.05);
      trackNode(osc);
    }

    spawnOsc(note.freq, 1, note.wave, detune);
    if (note.harmonic) {
      spawnOsc(note.freq * harmonicRatio, harmonicMix, "sine", detune * 0.5);
      if (!live && (kind === "melody" || kind === "fill" || kind === "voice" || kind === "pad" || kind === "arp")) {
        spawnOsc(note.freq * 1.5, harmonicMix * 0.45, "sine", -detune * 0.25);
      }
    } else if (kind === "snare") {
      spawnOsc(note.freq * 1.8, 0.1, "sine", detune);
    } else if (kind === "accent" || kind === "spark") {
      spawnOsc(note.freq * 2, 0.08, "sine", detune);
    } else if (!live && (kind === "melody" || kind === "pad" || kind === "arp") && harmonicMix > 0.18) {
      spawnOsc(note.freq * harmonicRatio, harmonicMix * 0.55, "sine", detune + 3);
    }

    if (noiseMix > 0.01) {
      var noiseType = kind === "hat" ? "highpass" : kind === "kick" ? "lowpass" : "bandpass";
      noiseBurst(ctx, dest, when, Math.min(dur * 0.85, 0.14), peak * noiseMix, note.noiseFilter || 1200, note.noiseQ, noiseType);
    }
  }

  function scoreStemBus(buses, stem) {
    if (stem === "colors") return buses.colors;
    if (stem === "spells") return buses.spells;
    return buses.melody;
  }

  function synthesizeFromScore(score, chunkOffset, chunkDur) {
    if (!score || !score.notes || !score.notes.length) return Promise.resolve(null);
    var ctx = createOfflineContext(chunkDur);
    var buses = createStemBuses(ctx);
    var i;
    var note;
    var localT;
    for (i = 0; i < score.notes.length; i++) {
      note = score.notes[i];
      localT = note.t - chunkOffset;
      if (localT < -0.04 || localT >= chunkDur - 0.01) continue;
      emitScoreNote(ctx, scoreStemBus(buses, note.stem), localT, note, { trackSources: false });
    }
    return startOfflineRender(ctx, false).then(splitStemBuffer);
  }

  function synthesizeFullChunkedFromScore(score, duration, genId) {
    var chunkSec = FULL_CHUNK_SEC;
    var chunks = Math.ceil(duration / chunkSec);
    var parts = [];
    var i = 0;

    function renderChunk() {
      if (genId !== state.composeGen) return Promise.resolve(null);
      if (i >= chunks) return Promise.resolve(concatStemBuffers(parts));
      var offset = i * chunkSec;
      var chunkDur = Math.min(chunkSec, duration - offset);
      return synthesizeFromScore(score, offset, chunkDur).then(function (stems) {
        if (!stems) return null;
        parts.push(stems);
        i++;
        return renderChunk();
      });
    }

    return renderChunk();
  }

  function scheduleLiveNote(ctx, dest, startTime, note, offset, rate) {
    var localT = note.t - offset;
    if (localT < -0.04) return;
    try {
      emitScoreNote(ctx, dest, startTime + localT / rate, note, { rate: rate, trackSources: false, live: true });
    } catch (e) {
      if (!state.liveScheduleErrors) state.liveScheduleErrors = 0;
      if (state.liveScheduleErrors < 3) {
        console.warn("Ears live note failed:", e);
        state.liveScheduleErrors++;
      }
    }
  }

  function startLiveScoreScheduler(score, offset, startTime, rate, dest) {
    stopLiveScoreScheduler();
    state.liveScheduleErrors = 0;
    var notes = score.notes || [];
    var scheduled = new Array(notes.length);
    var lookahead = 3.2;
    var bootTicks = 0;

    function tick() {
      if (!state.playing || !state.livePlayback || !state.audioCtx) return;
      var now = state.audioCtx.currentTime;
      var playhead = offset + (now - startTime) * rate;
      var horizon = playhead + lookahead;
      var i;
      var count = 0;
      var maxPerTick = bootTicks < 4 ? 96 : 48;
      bootTicks++;

      for (i = 0; i < notes.length; i++) {
        if (notes[i].t > horizon) break;
        if (scheduled[i]) continue;
        if (notes[i].t < playhead - 0.3) {
          scheduled[i] = 1;
          continue;
        }
        scheduled[i] = 1;
        scheduleLiveNote(state.audioCtx, dest[notes[i].stem] || dest.melody, startTime, notes[i], offset, rate);
        count++;
        if (count >= maxPerTick) break;
      }

      if (playhead < score.duration - 0.05) {
        state.liveScheduleTimer = setTimeout(tick, 35);
      }
    }

    tick();
  }

  function scheduleMasterFadeOut(score, startTime, offset, rate) {
    var comp = score.composition;
    if (!comp || !state.masterGain || !state.audioCtx) return;
    var outroStart = comp.outroStart >= 0 ? comp.outroStart : Math.max(0, comp.totalBars - 2);
    var outroT = outroStart * comp.barDur;
    if (outroT >= score.duration - 0.35) return;
    var local = outroT - (offset || 0);
    if (local < 0) local = 0;
    var when = startTime + local / rate;
    var fadeLen = (score.duration - outroT) / rate;
    var vol = getTweaks().volume;
    var gain = state.masterGain.gain;
    var now = state.audioCtx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(vol, now);
    if (when > now + 0.05) {
      gain.setValueAtTime(vol, when);
      gain.linearRampToValueAtTime(0.0001, when + fadeLen + 0.2);
    }
  }

  function onLiveScoreEnded() {
    if (!state.livePlayback && !state.liveScore) return;
    var dur = state.liveScore ? state.liveScore.duration : bufferDuration();
    state.livePlayback = false;
    state.paused = false;
    handlePlaybackEnded(dur);
  }

  function playLiveScore(score, offset) {
    if (!score || !score.notes || !score.notes.length) {
      setStatus("Score has no notes — try Regenerate sound.", "error");
      return Promise.resolve();
    }
    return ensureAudioGraph()
      .then(function () {
        return resumeAudioContext();
      })
      .then(function () {
      stopAudioKeepWarm();
      disconnectSources();
      buildMixNodes();
      offset = Math.max(0, Math.min(offset || 0, score.duration - 0.02));
      var rate = getTweaks().tempo;
      var startTime = state.audioCtx.currentTime + 0.04;
      resetMasterGainVolume();
      state.playhead = offset;
      state.playbackStartCtxTime = startTime;
      state.playbackRate = rate;
      state.liveScore = score;
      state.livePlayback = true;
      state.stems = null;
      state.buffer = null;

      var dest = {
        melody: state.mixNodes.stemMelody,
        beat: state.mixNodes.stemMelody,
        vocal: state.mixNodes.stemMelody,
        colors: state.mixNodes.stemColors,
        spells: state.mixNodes.stemSpells,
      };

      startLiveScoreScheduler(score, offset, startTime, rate, dest);
      scheduleMasterFadeOut(score, startTime, offset, rate);

      var remain = (score.duration - offset) / rate;
      state.liveEndTimer = setTimeout(onLiveScoreEnded, remain * 1000 + 120);

      applyLiveMix();
      state.playing = true;
      state.paused = false;
      var stage = $("ea-stage");
      if (stage) stage.classList.add("ea-has-sound");
      startVisualizer();
      updateTransport();
    });
  }

  function freqToMidi(freq) {
    return Math.round(69 + 12 * Math.log2(freq / 440));
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function midiLabel(midi) {
    var names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    var oct = Math.floor(midi / 12) - 1;
    return names[((midi % 12) + 12) % 12] + oct;
  }

  function cloneScoreNote(note) {
    return {
      stem: note.stem || "melody",
      t: note.t,
      freq: note.freq,
      dur: note.dur,
      peak: note.peak,
      wave: note.wave || "triangle",
      kind: note.kind || "note",
      harmonic: !!note.harmonic,
      slideTo: note.slideTo || 0,
      detune: note.detune || 0,
      filterHz: note.filterHz || 0,
      filterQ: note.filterQ != null ? note.filterQ : 1,
      filterType: note.filterType || "lowpass",
      harmonicRatio: note.harmonicRatio || 2,
      harmonicMix: note.harmonicMix != null ? note.harmonicMix : 0.42,
      noiseMix: note.noiseMix || 0,
      noiseFilter: note.noiseFilter || 1200,
      noiseQ: note.noiseQ != null ? note.noiseQ : 1.1,
    };
  }

  function ensureScoreEdit() {
    if (!state.scoreEdit) {
      state.scoreEdit = {
        notes: [],
        duration: SOUND_DURATION,
        composition: null,
        mood: null,
        key: null,
        selected: -1,
        dirty: false,
        drag: null,
        pitchMin: 48,
        pitchMax: 84,
        visible: false,
      };
    }
    return state.scoreEdit;
  }

  function scorePitchBounds(notes) {
    var minMidi = 96;
    var maxMidi = 36;
    var i;
    for (i = 0; i < notes.length; i++) {
      var m = freqToMidi(notes[i].freq);
      if (m < minMidi) minMidi = m;
      if (m > maxMidi) maxMidi = m;
    }
    if (!notes.length) return { min: 48, max: 84 };
    return { min: Math.max(24, minMidi - 4), max: Math.min(108, maxMidi + 4) };
  }

  function loadScoreIntoEditor(score) {
    var ed = ensureScoreEdit();
    var bounds = scorePitchBounds(score.notes || []);
    ed.notes = (score.notes || []).map(cloneScoreNote);
    ed.duration = score.duration || SOUND_DURATION;
    ed.composition = score.composition || null;
    ed.mood = score.mood || null;
    ed.key = score.key || null;
    ed.selected = ed.notes.length ? 0 : -1;
    ed.dirty = false;
    ed.pitchMin = bounds.min;
    ed.pitchMax = bounds.max;
    ed.visible = true;
    var panel = $("ea-score-panel");
    if (panel) panel.hidden = false;
    updateScoreToolbar();
    updateScoreHint();
    renderScoreRoll();
  }

  function getScoreFromEditor() {
    var ed = state.scoreEdit;
    if (!ed) return null;
    return {
      duration: ed.duration,
      notes: ed.notes.map(cloneScoreNote),
      mood: ed.mood,
      key: ed.key,
      composition: ed.composition,
    };
  }

  function markScoreDirty() {
    var ed = state.scoreEdit;
    if (!ed) return;
    ed.dirty = true;
    updateScoreToolbar();
  }

  function updateScoreToolbar() {
    var ed = state.scoreEdit;
    var has = ed && ed.notes.length > 0;
    var addBtn = $("ea-score-add");
    var delBtn = $("ea-score-del");
    var meta = $("ea-score-meta");
    if (addBtn) addBtn.disabled = !ed || !ed.visible;
    if (delBtn) delBtn.disabled = !ed || ed.selected < 0;
    if (meta) meta.textContent = has ? ed.notes.length + " waves · " + formatTime(ed.duration) : "0 waves";
  }

  function updateScoreHint() {
    var hint = $("ea-score-hint");
    var ed = state.scoreEdit;
    if (!hint || !ed || ed.selected < 0 || !ed.notes[ed.selected]) {
      if (hint && ed && ed.visible) {
        hint.textContent = "Score matches playback · drag waves — pitch height = note pitch · section labels show song form";
      }
      return;
    }
    var note = ed.notes[ed.selected];
    var lane = SCORE_LANES.filter(function (l) { return l.id === note.stem; })[0];
    hint.textContent =
      (lane ? lane.label : "Wave") +
      " · " +
      formatTime(note.t) +
      " · " +
      midiLabel(freqToMidi(note.freq)) +
      " · " +
      (note.wave || "sine") +
      (note.kind && note.kind !== "note" ? " · " + note.kind : "") +
      " · drag ↔ time · ↕ loudness · tip ↔ length";
  }

  function selectScoreNote(idx) {
    var ed = state.scoreEdit;
    if (!ed) return;
    ed.selected = idx;
    updateScoreToolbar();
    updateScoreHint();
    renderScoreRoll();
  }

  function auditionScoreLive() {
    clearTimeout(scoreAuditionTimer);
    scoreAuditionTimer = setTimeout(function () {
      var score = getScoreFromEditor();
      if (!score || !score.notes.length) return;
      state.stems = null;
      state.buffer = null;
      state.livePlayback = true;
      state.liveScore = score;
      var head = getPlayhead();
      if (state.playing) {
        playLiveScore(score, head);
      }
    }, 160);
  }

  function scoreCanvasMetrics(canvas) {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(280, Math.floor(rect.width));
    var h = Math.max(120, Math.floor(rect.height));
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    return { w: w, h: h, dpr: dpr, rect: rect };
  }

  function scoreLaneLayout(h) {
    var laneH = (h - 6) / SCORE_LANES.length;
    return { laneH: laneH, plotW: function (w) { return Math.max(1, w - SCORE_LANE_PAD); } };
  }

  function scoreLaneIndexAt(y, h) {
    var layout = scoreLaneLayout(h);
    var idx = Math.floor(y / layout.laneH);
    return Math.max(0, Math.min(SCORE_LANES.length - 1, idx));
  }

  function waveSample(wave, phase) {
    phase = phase - Math.floor(phase);
    if (wave === "square") return phase < 0.5 ? 1 : -1;
    if (wave === "sawtooth") return 2 * phase - 1;
    if (wave === "triangle") return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    return Math.sin(phase * Math.PI * 2);
  }

  function waveEnvelope(t, dur) {
    var a = Math.min(0.12, dur * 0.28);
    if (t < a) return Math.max(0.05, t / Math.max(0.01, a));
    return Math.max(0.05, 1 - (t - a) / Math.max(0.02, dur - a));
  }

  function waveGeom(note, ed, plotW, laneY, laneH) {
    var x = SCORE_LANE_PAD + (note.t / ed.duration) * plotW;
    var w = Math.max(14, (note.dur / ed.duration) * plotW);
    var midi = freqToMidi(note.freq);
    var pMin = ed.pitchMin || 48;
    var pMax = ed.pitchMax || 84;
    var pitchT = Math.max(0, Math.min(1, (midi - pMin) / Math.max(1, pMax - pMin)));
    var baseY = laneY + laneH * 0.9 - pitchT * laneH * 0.76;
    var amp = note.peak * laneH * (note.stem === "beat" ? 1.2 : 1.55);
    var cycles = Math.max(1.5, note.dur * note.freq * 0.12);
    var steps = Math.max(10, Math.floor(w / 4));
    var points = [];
    var i;
    var frac;
    var t;
    var env;
    var py;
    for (i = 0; i <= steps; i++) {
      frac = i / steps;
      t = frac * note.dur;
      env = waveEnvelope(t, note.dur);
      py = baseY - waveSample(note.wave || "triangle", frac * cycles) * env * amp;
      points.push({ x: x + frac * w, y: py });
    }
    return { x: x, y: laneY, w: w, h: laneH, midY: baseY, points: points, endX: x + w, endY: baseY };
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = dx * dx + dy * dy;
    var t = len < 0.001 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
    var cx = x1 + t * dx;
    var cy = y1 + t * dy;
    dx = px - cx;
    dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function hitTestWave(clientX, clientY) {
    var canvas = $("ea-score-roll");
    var ed = state.scoreEdit;
    if (!canvas || !ed) return null;
    var m = scoreCanvasMetrics(canvas);
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var layout = scoreLaneLayout(m.h);
    var plotW = layout.plotW(m.w);
    var i;
    var note;
    var geom;
    var laneIdx;
    var laneY;
    var pi;
    var best = null;
    var bestDist = 999;

    for (i = ed.notes.length - 1; i >= 0; i--) {
      note = ed.notes[i];
      laneIdx = 0;
      SCORE_LANES.forEach(function (l, idx) {
        if (l.id === note.stem) laneIdx = idx;
      });
      laneY = laneIdx * layout.laneH + 3;
      geom = waveGeom(note, ed, plotW, laneY, layout.laneH - 6);
      if (Math.sqrt((x - geom.endX) * (x - geom.endX) + (y - geom.endY) * (y - geom.endY)) < 12) {
        return { idx: i, mode: "dur" };
      }
      for (pi = 0; pi < geom.points.length - 1; pi++) {
        var d = distToSegment(
          x,
          y,
          geom.points[pi].x,
          geom.points[pi].y,
          geom.points[pi + 1].x,
          geom.points[pi + 1].y
        );
        if (d < bestDist && d < 14) {
          bestDist = d;
          best = { idx: i, mode: "amp" };
        }
      }
    }
    return best;
  }

  function renderScoreRoll() {
    var canvas = $("ea-score-roll");
    var ed = state.scoreEdit;
    if (!canvas || !ed || !ed.visible) return;
    var m = scoreCanvasMetrics(canvas);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    ctx.clearRect(0, 0, m.w, m.h);
    ctx.fillStyle = "#06040c";
    ctx.fillRect(0, 0, m.w, m.h);

    var layout = scoreLaneLayout(m.h);
    var plotW = layout.plotW(m.w);
    var li;
    var lane;
    var laneY;

    for (li = 0; li < SCORE_LANES.length; li++) {
      lane = SCORE_LANES[li];
      laneY = li * layout.laneH;
      ctx.fillStyle = li % 2 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.035)";
      ctx.fillRect(SCORE_LANE_PAD, laneY + 1, plotW, layout.laneH - 2);
      ctx.fillStyle = "rgba(200, 168, 255, 0.55)";
      ctx.font = "10px DM Sans, sans-serif";
      ctx.fillText(lane.label, 6, laneY + layout.laneH * 0.55);
    }

    var barDur = ed.composition && ed.composition.barDur ? ed.composition.barDur : ed.duration / 8;
    var sections = ed.composition && ed.composition.sections ? ed.composition.sections : [];
    var bar;
    var bx;
    var sec;
    var bandStart = 0;
    var bandSec = sections[0] || "";
    var x0;
    var x1;
    if (sections.length) {
      for (bar = 1; bar <= sections.length; bar++) {
        sec = sections[bar] || "";
        if (bar === sections.length || sec !== bandSec) {
          x0 = SCORE_LANE_PAD + (bandStart * barDur / ed.duration) * plotW;
          x1 = SCORE_LANE_PAD + (bar * barDur / ed.duration) * plotW;
          ctx.fillStyle = SCORE_SECTION_COLORS[bandSec] || "rgba(255,255,255,0.06)";
          ctx.fillRect(x0, 0, Math.max(2, x1 - x0), m.h);
          if (bandSec) {
            ctx.fillStyle = "rgba(220, 200, 255, 0.72)";
            ctx.font = "9px DM Sans, sans-serif";
            ctx.fillText(bandSec.toUpperCase(), x0 + 3, 11);
          }
          bandStart = bar;
          bandSec = sec;
        }
      }
    }
    for (bar = 0; bar * barDur < ed.duration + 0.01; bar++) {
      bx = SCORE_LANE_PAD + (bar * barDur / ed.duration) * plotW;
      ctx.strokeStyle = "rgba(180, 120, 255, 0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx, m.h);
      ctx.stroke();
    }

    var head = Math.min(getPlayhead(), ed.duration);
    var px = SCORE_LANE_PAD + (head / ed.duration) * plotW;
    ctx.strokeStyle = "rgba(232, 200, 120, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, m.h);
    ctx.stroke();

    var i;
    var note;
    var geom;
    var laneIdx;
    var color;
    var pi;
    for (i = 0; i < ed.notes.length; i++) {
      note = ed.notes[i];
      laneIdx = 0;
      SCORE_LANES.forEach(function (l, idx) {
        if (l.id === note.stem) laneIdx = idx;
      });
      laneY = laneIdx * layout.laneH + 3;
      geom = waveGeom(note, ed, plotW, laneY, layout.laneH - 6);
      color = SCORE_KIND_COLORS[note.kind] || SCORE_STEM_COLORS[note.stem] || SCORE_STEM_COLORS.melody;
      ctx.strokeStyle = color;
      ctx.lineWidth =
        i === ed.selected ? 2.6 : note.kind === "kick" || note.kind === "bass" ? 2.2 : note.kind === "pad" ? 1.2 : 1.5;
      if (note.kind === "hat" || note.kind === "snap") {
        ctx.setLineDash([3, 3]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = i === ed.selected ? 1 : 0.78;
      ctx.beginPath();
      for (pi = 0; pi < geom.points.length; pi++) {
        if (pi === 0) ctx.moveTo(geom.points[pi].x, geom.points[pi].y);
        else ctx.lineTo(geom.points[pi].x, geom.points[pi].y);
      }
      ctx.stroke();
      ctx.fillStyle = i === ed.selected ? "#fff" : color;
      ctx.beginPath();
      ctx.arc(geom.endX, geom.endY, i === ed.selected ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function snapScoreTime(t) {
    var ed = state.scoreEdit;
    if (!ed || !ed.composition || !ed.composition.eighth) return t;
    var grid = ed.composition.eighth;
    return Math.round(t / grid) * grid;
  }

  function addScoreNote(atTime, stem) {
    var ed = ensureScoreEdit();
    var t = atTime == null ? Math.min(ed.duration * 0.25, ed.duration - 0.05) : atTime;
    var newKind =
      stem === "beat" ? "kick" : stem === "spells" ? "accent" : stem === "colors" ? "scene" : stem === "vocal" ? "voice" : "melody";
    var newTimbre = mergeNoteTimbre(newKind, { wave: MELODY_WAVE_ROTATION[ed.notes.length % MELODY_WAVE_ROTATION.length] });
    ed.notes.push({
      stem: stem || "melody",
      t: snapScoreTime(Math.max(0, Math.min(ed.duration - 0.02, t))),
      freq: midiToFreq(64 + (ed.notes.length % 5) * 2),
      dur: ed.composition && ed.composition.eighth ? ed.composition.eighth * 0.8 : 0.2,
      peak: 0.09,
      wave: newTimbre.wave || "triangle",
      kind: newKind,
      harmonic: !!newTimbre.harmonic,
      slideTo: 0,
      detune: newTimbre.detune || 0,
      filterHz: newTimbre.filterHz || 0,
      filterQ: newTimbre.filterQ != null ? newTimbre.filterQ : 1,
      filterType: newTimbre.filterType || "lowpass",
      harmonicRatio: newTimbre.harmonicRatio || 2,
      harmonicMix: newTimbre.harmonicMix != null ? newTimbre.harmonicMix : 0.42,
      noiseMix: newTimbre.noiseMix || 0,
      noiseFilter: newTimbre.noiseFilter || 1200,
      noiseQ: newTimbre.noiseQ != null ? newTimbre.noiseQ : 1.1,
    });
    ed.notes.sort(function (a, b) {
      return a.t - b.t;
    });
    ed.selected = ed.notes.length - 1;
    markScoreDirty();
    updateScoreHint();
    renderScoreRoll();
    auditionScoreLive();
  }

  function deleteScoreNote() {
    var ed = state.scoreEdit;
    if (!ed || ed.selected < 0) return;
    ed.notes.splice(ed.selected, 1);
    ed.selected = Math.min(ed.selected, ed.notes.length - 1);
    markScoreDirty();
    updateScoreHint();
    renderScoreRoll();
    auditionScoreLive();
  }

  function bindScoreEditor() {
    var canvas = $("ea-score-roll");
    if (!canvas) return;

    function pointerToLaneTime(clientX, clientY) {
      var ed = state.scoreEdit;
      if (!ed) return { t: 0, stem: "melody" };
      var m = scoreCanvasMetrics(canvas);
      var rect = canvas.getBoundingClientRect();
      var x = clientX - rect.left;
      var y = clientY - rect.top;
      var plotW = scoreLaneLayout(m.h).plotW(m.w);
      var t = ((x - SCORE_LANE_PAD) / plotW) * ed.duration;
      var laneIdx = scoreLaneIndexAt(y, m.h);
      return { t: t, stem: SCORE_LANES[laneIdx].id };
    }

    canvas.addEventListener("pointerdown", function (e) {
      var ed = state.scoreEdit;
      if (!ed || !ed.visible) return;
      canvas.setPointerCapture(e.pointerId);
      var hit = hitTestWave(e.clientX, e.clientY);
      if (hit) {
        selectScoreNote(hit.idx);
        var note = ed.notes[hit.idx];
        ed.drag = {
          pointerId: e.pointerId,
          idx: hit.idx,
          mode: hit.mode,
          startX: e.clientX,
          startY: e.clientY,
          origT: note.t,
          origDur: note.dur,
          origPeak: note.peak,
        };
      } else {
        var pos = pointerToLaneTime(e.clientX, e.clientY);
        if (e.clientX - canvas.getBoundingClientRect().left >= SCORE_LANE_PAD) {
          addScoreNote(pos.t, pos.stem);
          ed.drag = {
            pointerId: e.pointerId,
            idx: ed.selected,
            mode: "amp",
            startX: e.clientX,
            startY: e.clientY,
            origT: ed.notes[ed.selected].t,
            origDur: ed.notes[ed.selected].dur,
            origPeak: ed.notes[ed.selected].peak,
          };
        }
      }
      e.preventDefault();
    });

    canvas.addEventListener("pointermove", function (e) {
      var ed = state.scoreEdit;
      if (!ed || !ed.drag || ed.drag.pointerId !== e.pointerId) return;
      var m = scoreCanvasMetrics(canvas);
      var plotW = scoreLaneLayout(m.h).plotW(m.w);
      var dx = e.clientX - ed.drag.startX;
      var dy = e.clientY - ed.drag.startY;
      var note = ed.notes[ed.drag.idx];
      if (!note) return;

      if (ed.drag.mode === "dur") {
        note.dur = Math.max(0.04, Math.min(ed.duration - note.t, ed.drag.origDur + (dx / plotW) * ed.duration));
      } else if (ed.drag.mode === "amp") {
        note.peak = Math.max(0.015, Math.min(0.38, ed.drag.origPeak - dy * 0.0022));
        if (Math.abs(dx) > 4) {
          note.t = Math.max(0, Math.min(ed.duration - 0.02, ed.drag.origT + (dx / plotW) * ed.duration));
        }
      } else {
        note.t = Math.max(0, Math.min(ed.duration - 0.02, ed.drag.origT + (dx / plotW) * ed.duration));
        note.peak = Math.max(0.015, Math.min(0.38, ed.drag.origPeak - dy * 0.0022));
      }

      markScoreDirty();
      updateScoreHint();
      renderScoreRoll();
      auditionScoreLive();
    });

    function endDrag(e) {
      var ed = state.scoreEdit;
      if (!ed || !ed.drag || ed.drag.pointerId !== e.pointerId) return;
      var note = ed.notes[ed.drag.idx];
      if (note) {
        note.t = snapScoreTime(note.t);
        updateScoreHint();
        renderScoreRoll();
        auditionScoreLive();
      }
      ed.drag = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    window.addEventListener("resize", function () {
      if (state.scoreEdit && state.scoreEdit.visible) renderScoreRoll();
    });

    $("ea-score-add") &&
      $("ea-score-add").addEventListener("click", function () {
        addScoreNote();
      });
    $("ea-score-del") &&
      $("ea-score-del").addEventListener("click", function () {
        deleteScoreNote();
      });
  }

  function stopPlayback() {
    if (state.playing) {
      state.playhead = getPlayhead();
    }
    stopVocalPlaybackSource();
    state.playing = false;
    state.paused = false;
    state.livePlayback = false;
    disconnectSources();
    stopAudioKeepWarm();
    stopVisualizer();
    updateTransport();
  }

  function stopPlaybackForGenerate() {
    stopVocalPlaybackSource();
    stopPlayback();
    state.playhead = 0;
    state.awaitingVision = false;
    updateTransport();
  }

  function startPlaybackAt(offset) {
    if (shouldUseLiveScore(offset)) {
      state.liveScore = getScoreFromEditor() || state.liveScore;
      state.livePlayback = true;
      offset = Math.max(0, Math.min(offset || 0, (state.liveScore && state.liveScore.duration) || SOUND_DURATION) - 0.02);
      state.playhead = offset;
      return playLiveScore(state.liveScore, offset);
    }
    state.livePlayback = false;
    return ensureAudioGraph()
      .then(function () {
        return resumeAudioContext();
      })
      .then(function () {
      if (!hasSoundReady()) return;
      if (!state.stems && !state.buffer) {
        if (offset >= (state.liveScore ? state.liveScore.duration : PREVIEW_DURATION) - 0.05) {
          state.playhead = offset;
          return tryContinuePastPreview(offset);
        }
      }
      var dur = bufferDuration();
      if (!state.stems && !state.buffer && state.liveScore) {
        dur = state.liveScore.duration;
      } else if (state.stems && state.stems.melody) {
        dur = state.stems.melody.duration;
      }
      offset = Math.max(0, Math.min(offset, dur - 0.02));

      disconnectSources();
      resetMasterGainVolume();
      state.playhead = offset;
      state.playbackStartCtxTime = state.audioCtx.currentTime;
      var rate = getTweaks().tempo;
      state.playbackRate = rate;
      var ended = 0;
      var total = 0;

      function onStemEnded() {
        ended++;
        if (ended < total) return;
        handlePlaybackEnded(dur);
      }

      function playStem(buffer, gainNode) {
        if (!buffer || !gainNode) return;
        var src = state.audioCtx.createBufferSource();
        src.buffer = buffer;
        setSourcePlaybackSpeed(src, rate);
        src.connect(gainNode);
        src.onended = onStemEnded;
        src.start(0, offset);
        state.sources.push(src);
        total++;
      }

      if (state.stems && state.mixNodes) {
        playStem(state.stems.melody, state.mixNodes.stemMelody);
        playStem(state.stems.colors, state.mixNodes.stemColors);
        playStem(state.stems.spells, state.mixNodes.stemSpells);
      } else if (state.buffer) {
        var legacy = state.audioCtx.createBufferSource();
        legacy.buffer = state.buffer;
        setSourcePlaybackSpeed(legacy, rate);
        legacy.connect(state.analyser);
        legacy.onended = onStemEnded;
        legacy.start(0, offset);
        state.sources.push(legacy);
        state.source = legacy;
        total = 1;
      }

      if (total === 0 && state.liveScore && state.liveScore.notes && state.liveScore.notes.length) {
        state.livePlayback = true;
        return playLiveScore(state.liveScore, offset);
      }

      applyLiveMix();
      state.playing = true;
      state.paused = false;
      var stage = $("ea-stage");
      if (stage) stage.classList.add("ea-has-sound");
      startVisualizer();
      updateTransport();
    });
  }

  function playOrResume() {
    if (!hasSoundReady() || state.generating) return Promise.resolve();
    if (state.playing) return Promise.resolve();
    var offset = state.playhead;
    if (offset >= bufferDuration() - 0.05) offset = 0;
    setStatus(offset > 0.05 ? "Resuming…" : "Playing…", "pending");
    return startPlaybackAt(offset);
  }

  function pausePlayback() {
    if (!state.playing) return;
    state.playhead = getPlayhead();
    disconnectSources();
    state.playing = false;
    state.paused = true;
    stopVisualizer();
    updateTransport();
    setStatus("Paused at " + formatTime(state.playhead) + " — scrub or Play.", "ok");
  }

  function resetPlayback() {
    stopVocalPlaybackSource();
    stopPlayback();
    state.playhead = 0;
    state.paused = false;
    updateTransport();
    updateScanline();
    setStatus("Reset to 0:00.", "ok");
  }

  function seekTo(seconds) {
    if (!hasSoundReady()) return;
    var dur = bufferDuration();
    seconds = Math.max(0, Math.min(seconds, dur));
    state.playhead = seconds;
    updateScanline();
    if (state.playing) {
      startPlaybackAt(seconds);
      setStatus("Skipped to " + formatTime(seconds) + ".", "ok");
    } else {
      updateTransport();
    }
  }

  function setStemsAndPlay(stems) {
    state.stems = stems;
    state.buffer = stems.melody;
    state.playhead = 0;
    state.remixPending = false;
    state.structureDirty = false;
    applyLiveMix();
    updateRemixButton();
    updateTransport();
    markComposePlaybackStarting();
    return startPlaybackAt(0).then(function () {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            var readyMsg = state.stemsFullReady ? "Full track playing" : "Preview playing";
            markComposeAudible(readyMsg);
            var msg = state.stemsFullReady
              ? "Playing — mix sliders update the sound live."
              : "Playing preview — full track loading in background.";
            setStatus(msg, "ok");
            setTimeout(function () {
              hideComposeProgress();
              resolve();
            }, 480);
          });
        });
      });
    });
  }

  function renderApplied() {
    var row = $("ea-applied");
    if (!row) return;
    row.innerHTML = "";
    if (!state.applied.length) {
      row.innerHTML = '<span class="ea-applied-empty">No spells — drag from tray onto the stage.</span>';
      renderImagine();
      return;
    }
    state.applied.forEach(function (item, idx) {
      var chip = document.createElement("span");
      chip.className = "ea-chip";
      chip.textContent = item.label || "Spell";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "ea-chip-rm";
      rm.textContent = "×";
      rm.dataset.idx = String(idx);
      chip.appendChild(rm);
      row.appendChild(chip);
    });
    if (state.applied[0]) {
      state.accentColor = spellAccentColor(state.applied[0], 0);
    }
    renderImagine();
  }

  function addSpell(item) {
    if (state.generating) return;
    item = normalizeSpell(item);
    if (!item.url) return;
    var exists = state.applied.some(function (s) {
      return s.paintingNum === item.paintingNum;
    });
    if (exists) {
      setStatus("That spell is already equipped.", "error");
      return;
    }
    if (state.applied.length >= 12) {
      setStatus("Max 12 spells per sound.", "error");
      return;
    }
    state.applied.push(item);
    renderApplied();
    updateRemixButton();
    if (state.stems) {
      state.structureDirty = true;
      setStatus("Spell equipped — Regenerate sound to hear its unique layer.", "ok");
    } else {
      setStatus("Spell equipped — Generate sound to hear it.", "ok");
    }
  }

  function unlockGenerateUi() {
    state.generating = false;
    document.querySelectorAll(".ea-btn, .ea-spell").forEach(function (el) {
      el.disabled = false;
    });
    updateRemixButton();
  }

  function upgradeStemsInBackground(spells, genId) {
    state.fullBuildActive = true;
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (genId !== state.composeGen) {
          state.fullBuildActive = false;
          resolve();
          return;
        }
        var mood = state.promptMood || getEffectiveMood(analyzeListeningPrompt(getEarsPrompt()));
        var key = promptToKey(mood, spells);
        var fullComp = buildComposition(mood, SOUND_DURATION, key);
        var fullScore = buildMelodyScore(spells, SOUND_DURATION, mood, key, fullComp);
        state.masterScore = fullScore;
        synthesizeFullChunkedFromScore(fullScore, SOUND_DURATION, genId)
          .then(function (fullStems) {
            resolve(fullStems);
          })
          .catch(function () {
            resolve(null);
          });
      }, 0);
    }).then(function (fullStems) {
        if (!fullStems) return;
        if (genId !== state.composeGen) return;
        var wasPlaying = state.playing;
        var head = wasPlaying ? getPlayhead() : state.playhead;
        var ed = state.scoreEdit;
        if (!ed || !ed.dirty) loadScoreIntoEditor(state.masterScore);
        state.stems = fullStems;
        state.buffer = fullStems.melody;
        state.stemsFullReady = true;
        state.fullBuildActive = false;
        if (scoreNeedsLivePlayback()) {
          state.liveScore = getScoreFromEditor();
          state.livePlayback = true;
        } else {
          state.livePlayback = false;
          state.liveScore = null;
        }
        updateTransport();
        hideComposeProgress();
        if (wasPlaying || state.awaitingFullContinue) {
          head = Math.min(Math.max(head, 0), fullStems.melody.duration - 0.02);
          return startPlaybackAt(head).then(function () {
            state.awaitingFullContinue = false;
            setStatus("Full ~3:00 render ready — keeps playing, loops at the end.", "ok");
          });
        }
        setStatus("Full ~3:00 render ready — hit Play to hear the full timeline.", "ok");
      })
      .catch(function () {
        if (genId === state.composeGen) {
          state.fullBuildActive = false;
          if (state.awaitingFullContinue) {
            setStatus("Full track build stalled — hit Play to retry or Regenerate.", "error");
          }
        }
      });
  }

  function loadVisionsInBackground(mood) {
    if (state.visionsGenerating) return;
    setStatus("Playing — painting visions from your words in the background…", "ok");
    generateVisionPair(state.applied, mood)
      .then(function (visions) {
        if (visions && (visions.a || visions.b)) applyVisionImages(visions.a, visions.b);
      })
      .catch(function () {})
      .finally(function () {
        if (state.playing) setStatus("Playing — mix sliders respond live.", "ok");
      });
  }

  function earsGenerate(options) {
    options = options || {};
    if (state.generating) return Promise.resolve();
    if (!state.applied.length) {
      setStatus("Drag spells onto the stage first.", "error");
      return Promise.resolve();
    }

    state.generating = true;
    document.querySelectorAll(".ea-btn, .ea-spell").forEach(function (el) {
      el.disabled = true;
    });
    var genId = ++state.composeGen;
    state.stemsFullReady = false;
    state.awaitingFullContinue = false;
    state.fullBuildActive = false;
    state.livePlayback = false;
    state.liveScore = null;
    setStatus("Scoring melody notes from your prompt…", "pending");

    stopPlaybackForGenerate();

    var spells = state.applied.slice();
    var analyzed;
    var mood;
    var key;
    var composition;
    try {
      analyzed = analyzeListeningPrompt(getEarsPrompt());
      mood = getEffectiveMood(analyzed);
      key = promptToKey(mood, spells);
      composition = buildComposition(mood, SOUND_DURATION, key);
    } catch (prepErr) {
      unlockGenerateUi();
      setStatus((prepErr && prepErr.message) || "Could not build composition.", "error");
      return Promise.resolve();
    }

    startComposeProgress("Scoring melody from your prompt", 900, false);
    if (state.composeProgress) {
      state.composeProgress.prepStep = "notes";
      tickComposeProgress();
    }

    return ensureAudioGraph()
      .then(function () {
        if (genId !== state.composeGen) return;
        startAudioKeepWarm();
        state.promptMood = mood;
        var score = buildMelodyScore(spells, SOUND_DURATION, mood, key, composition);
        state.masterScore = score;
        loadScoreIntoEditor(score);
        if (state.composeProgress) {
          state.composeProgress.prepStep = "scored";
          state.composeProgress.label = "Melody scored — painting vision";
          tickComposeProgress();
        }
        setStatus("Score ready — painting vision before playback starts…", "pending");
        return waitForVisionThenPlay(score, spells, mood, genId, options);
      })
      .then(function () {
        if (genId !== state.composeGen) return;
        unlockGenerateUi();
        markComposeAudible("Score playing");
        setStatus("Playing full ~3:00 score — loops at the end. High-quality render building…", "ok");
        setTimeout(hideComposeProgress, 350);
      })
      .then(function () {
        if (genId !== state.composeGen) return;
        return state.fullBuildPromise || Promise.resolve();
      })
      .catch(function (err) {
        if (genId !== state.composeGen) return;
        cancelComposeProgress(true);
        unlockGenerateUi();
        setStatus(err.message || "Could not generate sound.", "error");
      });
  }

  function loadSpellPool() {
    if (state.poolReady) return Promise.resolve();
    return (window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }))
      .then(function (data) {
        state.pool = (data.manifest || []).map(function (m) {
          return normalizeSpell(spellRow(m));
        });
        state.poolReady = true;
        fillTrayRandom();
        renderTray();
      });
  }

  function fillTrayRandom() {
    var copy = state.pool.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    state.trayItems = copy.slice(0, CAST_TRAY_SLICE);
  }

  function renderTray() {
    var strip = $("ea-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell ea-spell";
      el.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    var count = $("ea-tray-count");
    if (count) count.textContent = state.trayItems.length + " shown · drag onto stage";
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "st-drag-ghost";
    var img = document.createElement("img");
    img.src = item.url;
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    return ghost;
  }

  function isOverStage(x, y) {
    var stage = $("ea-stage");
    if (!stage) return false;
    var rect = stage.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function onPointerDown(e) {
    if (state.generating) return;
    var spell = e.target.closest(".ea-spell");
    if (!spell || !spell.closest("#ea-spell-strip")) return;
    var item = normalizeSpell(state.trayItems[parseInt(spell.dataset.idx, 10)]);
    if (!item.url) return;
    e.preventDefault();
    spell.setPointerCapture(e.pointerId);
    state.drag = {
      item: item,
      ghost: createGhost(item, e.clientX, e.clientY),
      pointerId: e.pointerId,
    };
    var stage = $("ea-stage");
    if (stage) stage.classList.add("ea-drop-active");
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    var drag = state.drag;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    var stage = $("ea-stage");
    if (stage) stage.classList.remove("ea-drop-active");
    if (isOverStage(e.clientX, e.clientY)) addSpell(drag.item);
    state.drag = null;
  }

  function onPointerMove(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag.ghost.style.left = e.clientX + "px";
    state.drag.ghost.style.top = e.clientY + "px";
  }

  function onPointerCancel(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    if (state.drag.ghost.parentNode) state.drag.ghost.parentNode.removeChild(state.drag.ghost);
    var stage = $("ea-stage");
    if (stage) stage.classList.remove("ea-drop-active");
    state.drag = null;
  }

  function bindMixControl(cfg) {
    var el = $(cfg.id);
    if (!el) return;
    if (cfg.structure) el.classList.add("ea-mix-structure");
    else if (cfg.live) el.classList.add("ea-mix-live");
    el.addEventListener("input", function () {
      updateMixLabels();
      if (cfg.structure) {
        markStructureDirty();
        return;
      }
      if (cfg.live) {
        applyLiveMix();
        if (cfg.tempo && state.playing && state.stems) {
          var head = getPlayhead();
          startPlaybackAt(head);
        }
      }
    });
    el.addEventListener("change", function () {
      updateMixLabels();
    });
  }

  function bindUi() {
    bindScoreEditor();
    bindMixerKnobs();
    var input = $("ea-input");
    if (input) {
      input.addEventListener("input", function () {
        renderImagine();
        if (state.stems && !state.generating) {
          state.structureDirty = true;
          updateRemixButton();
          setStatus("Prompt changed — Generate or Regenerate sound to hear the new scene.", "ok");
        }
        if (state.vocal.mode) refreshVocalProfile();
      });
    }
    loadSavedOutputDevice();
    updateOutputRoutingUi([]);
    var outSel = $("ea-audio-output");
    if (outSel) {
      outSel.addEventListener("pointerdown", function () {
        primeOutputDeviceList();
      });
      outSel.addEventListener("focus", function () {
        primeOutputDeviceList();
      });
      outSel.addEventListener("change", function () {
        ensureAudioGraph()
          .then(function () {
            return resumeAudioContext();
          })
          .then(function () {
            return applyAudioOutput(outSel.value);
          })
          .catch(function () {
            setStatus("Could not switch speakers — try System default.", "err");
          });
      });
    }
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      var outputDeviceChangeTimer = 0;
      navigator.mediaDevices.addEventListener("devicechange", function () {
        if (!state.active) return;
        if (outputDeviceChangeTimer) clearTimeout(outputDeviceChangeTimer);
        outputDeviceChangeTimer = setTimeout(function () {
          outputDeviceChangeTimer = 0;
          primeOutputDeviceList();
        }, 400);
      });
    }
    loadSavedVocalOctave();
    loadSavedVocalLevel();
    var vocalOctave = $("ea-vocal-octave");
    if (vocalOctave) {
      vocalOctave.addEventListener("input", function () {
        applyVocalOctaveShift();
        if (state.vocal.liveOn) applyVocalMixProfile();
      });
      vocalOctave.addEventListener("change", function () {
        applyVocalOctaveShift();
        if (state.vocal.liveOn) applyVocalMixProfile();
      });
    }
    var vocalLevel = $("ea-vocal-level");
    if (vocalLevel) {
      vocalLevel.addEventListener("input", function () {
        applyVocalMonitorGain();
      });
      vocalLevel.addEventListener("change", function () {
        applyVocalMonitorGain();
      });
    }
    $("ea-vocal-live-btn") &&
      $("ea-vocal-live-btn").addEventListener("click", function () {
        toggleVocalLive();
      });
    $("ea-vocal-record-btn") &&
      $("ea-vocal-record-btn").addEventListener("click", function () {
        toggleVocalRecord();
      });
    MIX_CONTROLS.forEach(bindMixControl);
    updateMixLabels();
    $("ea-generate-btn") &&
      $("ea-generate-btn").addEventListener("click", function () {
        earsGenerate();
      });
    $("ea-remix-btn") &&
      $("ea-remix-btn").addEventListener("click", function () {
        earsGenerate({ remix: true });
      });
    $("ea-play-btn") &&
      $("ea-play-btn").addEventListener("click", function () {
        playOrResume();
      });
    $("ea-pause-btn") &&
      $("ea-pause-btn").addEventListener("click", function () {
        pausePlayback();
      });
    $("ea-reset-btn") &&
      $("ea-reset-btn").addEventListener("click", function () {
        resetPlayback();
      });
    var seek = $("ea-seek");
    if (seek) {
      seek.addEventListener("pointerdown", function () {
        state.scrubbing = true;
      });
      seek.addEventListener("pointerup", function () {
        state.scrubbing = false;
      });
      seek.addEventListener("input", function () {
        seekTo(parseFloat(seek.value) || 0);
      });
    }
    $("ea-randomize") &&
      $("ea-randomize").addEventListener("click", function () {
        fillTrayRandom();
        renderTray();
      });
    $("ea-applied") &&
      $("ea-applied").addEventListener("click", function (e) {
        var btn = e.target.closest(".ea-chip-rm");
        if (!btn) return;
        state.applied.splice(parseInt(btn.dataset.idx, 10), 1);
        renderApplied();
        if (state.stems) {
          state.structureDirty = true;
          setStatus("Spell removed — Regenerate sound to update the mix.", "ok");
        }
        updateRemixButton();
      });
    var strip = $("ea-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }
  }

  function onShow() {
    state.active = true;
    loadSpellPool();
    renderApplied();
    initBars();
    updateOutputRoutingUi([]);
  }

  function onHide() {
    state.active = false;
    stopVocal();
    stopAudioKeepWarm();
    stopPlayback();
  }

  function boot() {
    if (!$("panel-ears")) return;
    bindUi();
    initBars();
    renderApplied();
    updateTransport();
    loadSpellPool();
    window.dispatchEvent(new Event("ears-ready"));
  }

  window.Ears = {
    onShow: onShow,
    onHide: onHide,
    generate: earsGenerate,
    play: playOrResume,
    pause: pausePlayback,
    reset: resetPlayback,
    seek: seekTo,
    stop: stopPlayback,
  };
  window.addEventListener("ears-show", onShow);
  window.addEventListener("ears-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();