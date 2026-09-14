(function () {
  "use strict";

  var KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  var PHRASES = ["Hello", "Thank you", "Yes", "No", "Please", "Wait", "I need a minute", "Let's go"];

  var state = {
    stream: null,
    recStream: null,
    landmarker: null,
    raf: 0,
    running: false,
    buffer: "",
    dwellId: "",
    dwellSince: 0,
    lastLetter: "",
    lastLetterAt: 0,
    clips: [],
    recording: false,
    recorder: null,
    chunks: [],
    mirrored: true,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    var el = $("vh-status");
    if (el) el.textContent = text;
  }

  function setBuffer(text) {
    state.buffer = String(text || "");
    var el = $("vh-buffer");
    if (el) el.value = state.buffer;
  }

  function appendLetter(ch) {
    if (!ch) return;
    if (ch === "DEL") {
      setBuffer(state.buffer.slice(0, -1));
      return;
    }
    if (ch === "SPC") {
      if (state.buffer && !/\s$/.test(state.buffer)) setBuffer(state.buffer + " ");
      return;
    }
    if (ch === "SAY") {
      speak(state.buffer);
      return;
    }
    var now = performance.now();
    if (ch === state.lastLetter && now - state.lastLetterAt < 420) return;
    state.lastLetter = ch;
    state.lastLetterAt = now;
    setBuffer(state.buffer + ch);
  }

  function buildKeys() {
    var grid = $("vh-keys");
    if (!grid) return;
    grid.innerHTML = "";
    KEYS.concat(["SPC", "DEL", "SAY"]).forEach(function (id) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vh-key" + (id.length > 1 ? " wide" : "");
      btn.dataset.vhKey = id;
      btn.textContent = id === "SPC" ? "space" : id === "DEL" ? "del" : id === "SAY" ? "speak" : id;
      btn.addEventListener("click", function () {
        appendLetter(id);
      });
      grid.appendChild(btn);
    });
  }

  function buildPhrases() {
    var wrap = $("vh-phrases");
    if (!wrap) return;
    wrap.innerHTML = "";
    PHRASES.forEach(function (p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vh-btn";
      btn.textContent = p;
      btn.addEventListener("click", function () {
        setBuffer(p);
        speak(p);
      });
      wrap.appendChild(btn);
    });
  }

  function normText(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findClip(text) {
    var n = normText(text);
    if (!n) return null;
    var exact = state.clips.find(function (c) {
      return normText(c.label) === n;
    });
    if (exact) return exact;
    return state.clips.find(function (c) {
      return c.kind === "reference";
    }) || null;
  }

  function playUrl(url) {
    return new Promise(function (resolve) {
      var audio = $("vh-player");
      if (!audio) {
        resolve(false);
        return;
      }
      audio.src = url;
      audio.onended = function () {
        resolve(true);
      };
      audio.onerror = function () {
        resolve(false);
      };
      var p = audio.play();
      if (p && p.catch) p.catch(function () { resolve(false); });
    });
  }

  function browserSpeak(text) {
    if (!window.speechSynthesis || !text) return Promise.resolve(false);
    return new Promise(function (resolve) {
      try {
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.rate = 0.96;
        u.pitch = 0.9;
        u.onend = function () {
          resolve(true);
        };
        u.onerror = function () {
          resolve(false);
        };
        speechSynthesis.speak(u);
      } catch (err) {
        resolve(false);
      }
    });
  }

  function speak(text) {
    text = String(text || state.buffer || "").trim();
    if (!text) {
      setStatus("Point letters or type something to speak.");
      return Promise.resolve(false);
    }
    setStatus("Speaking…");
    return fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data && data.mode === "clip" && data.id) {
          setStatus("Playing your recorded voice.");
          return playUrl("/api/voice/audio?id=" + encodeURIComponent(data.id));
        }
        if (data && data.mode === "clips" && data.ids && data.ids.length) {
          setStatus("Playing your recorded words.");
          var chain = Promise.resolve(true);
          data.ids.forEach(function (id) {
            chain = chain.then(function () {
              return playUrl("/api/voice/audio?id=" + encodeURIComponent(id));
            });
          });
          return chain;
        }
        var clip = findClip(text);
        if (clip && clip.id) {
          setStatus("Playing a matching clip of your voice.");
          return playUrl("/api/voice/audio?id=" + encodeURIComponent(clip.id));
        }
        setStatus("No matching clip yet — stand-in voice until you record this line.");
        return browserSpeak(text);
      })
      .catch(function () {
        var clip = findClip(text);
        if (clip && clip.id) return playUrl("/api/voice/audio?id=" + encodeURIComponent(clip.id));
        setStatus("Server missed — stand-in voice.");
        return browserSpeak(text);
      });
  }

  function renderClips() {
    var list = $("vh-clips");
    if (!list) return;
    list.innerHTML = "";
    if (!state.clips.length) {
      list.innerHTML = "<p class='vh-status'>No clips yet. Record the script on the right.</p>";
      return;
    }
    state.clips.forEach(function (clip) {
      var row = document.createElement("div");
      row.className = "vh-clip";
      var name = document.createElement("span");
      name.textContent = (clip.label || clip.id) + (clip.kind === "reference" ? " · reference" : "");
      var play = document.createElement("button");
      play.type = "button";
      play.className = "vh-btn";
      play.textContent = "Play";
      play.addEventListener("click", function () {
        playUrl("/api/voice/audio?id=" + encodeURIComponent(clip.id));
      });
      var del = document.createElement("button");
      del.type = "button";
      del.className = "vh-btn danger";
      del.textContent = "Del";
      del.addEventListener("click", function () {
        fetch("/api/voice/clip?id=" + encodeURIComponent(clip.id), { method: "DELETE" })
          .then(loadClips)
          .catch(function () {
            setStatus("Could not delete clip.");
          });
      });
      row.appendChild(name);
      row.appendChild(play);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function loadClips() {
    return fetch("/api/voice/clips")
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        state.clips = (data && data.clips) || [];
        renderClips();
        var n = state.clips.length;
        if (!n) setStatus("Record your voice to start the bank.");
        else setStatus(n + " clip" + (n === 1 ? "" : "s") + " in the voice bank.");
      })
      .catch(function () {
        state.clips = [];
        renderClips();
      });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        var i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function uploadClip(blob, label, kind) {
    return blobToBase64(blob).then(function (b64) {
      return fetch("/api/voice/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label || "clip",
          kind: kind || "phrase",
          mime: blob.type || "audio/webm",
          audio_base64: b64,
        }),
      });
    }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || "save failed");
      return loadClips();
    });
  }

  function startMic() {
    if (state.recStream) return Promise.resolve(state.recStream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("No microphone"));
    }
    return navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } })
      .then(function (stream) {
        state.recStream = stream;
        return stream;
      });
  }

  function toggleRecord() {
    var btn = $("vh-record");
    if (state.recording) {
      try {
        state.recorder.stop();
      } catch (err) {}
      return;
    }
    startMic()
      .then(function (stream) {
        state.chunks = [];
        var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        state.recorder = new MediaRecorder(stream, { mimeType: mime });
        state.recorder.ondataavailable = function (e) {
          if (e.data && e.data.size) state.chunks.push(e.data);
        };
        state.recorder.onstop = function () {
          state.recording = false;
          if (btn) {
            btn.textContent = "Record";
            btn.classList.remove("active");
          }
          var blob = new Blob(state.chunks, { type: state.recorder.mimeType || "audio/webm" });
          var label = ($("vh-clip-label") && $("vh-clip-label").value) || "Logan voice";
          var kind = ($("vh-clip-kind") && $("vh-clip-kind").value) || "reference";
          setStatus("Saving clip…");
          uploadClip(blob, label, kind)
            .then(function () {
              setStatus("Saved “" + label + "” to the voice bank.");
            })
            .catch(function (err) {
              setStatus("Could not save clip. " + ((err && err.message) || ""));
            });
        };
        state.recorder.start();
        state.recording = true;
        if (btn) {
          btn.textContent = "Stop";
          btn.classList.add("active");
        }
        setStatus("Recording — read the script, then Stop.");
      })
      .catch(function () {
        setStatus("Microphone permission is needed to clone your voice.");
      });
  }

  function fingerExtended(lm, tip, pip, mcp) {
    var a = lm[tip];
    var b = lm[pip];
    var c = lm[mcp];
    if (!a || !b || !c) return false;
    var dTip = Math.hypot(a.x - lm[0].x, a.y - lm[0].y);
    var dPip = Math.hypot(b.x - lm[0].x, b.y - lm[0].y);
    return dTip > dPip * 1.12 && a.y < c.y + 0.02;
  }

  function classifyGesture(lm) {
    if (!lm || lm.length < 21) return "";
    var i = fingerExtended(lm, 8, 6, 5);
    var m = fingerExtended(lm, 12, 10, 9);
    var r = fingerExtended(lm, 16, 14, 13);
    var p = fingerExtended(lm, 20, 18, 17);
    var t = fingerExtended(lm, 4, 3, 2);
    var count = (i ? 1 : 0) + (m ? 1 : 0) + (r ? 1 : 0) + (p ? 1 : 0) + (t ? 1 : 0);
    if (i && !m && !r && !p) return "POINT";
    if (count >= 4) return "SPEAK";
    if (!i && !m && !r && !p) return "DEL";
    if (t && !i && !m && !r && !p) return "SPC";
    return "";
  }

  function hitKey(nx, ny) {
    var grid = $("vh-keys");
    var wrap = $("vh-cam-wrap");
    if (!grid || !wrap) return "";
    var rect = wrap.getBoundingClientRect();
    var x = rect.left + nx * rect.width;
    var y = rect.top + ny * rect.height;
    var nodes = grid.querySelectorAll(".vh-key");
    for (var i = 0; i < nodes.length; i += 1) {
      var b = nodes[i].getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) {
        return nodes[i].dataset.vhKey || "";
      }
    }
    return "";
  }

  function drawHands(landmarks) {
    var canvas = $("vh-overlay");
    var video = $("vh-video");
    if (!canvas || !video) return;
    var w = video.clientWidth || 640;
    var h = video.clientHeight || 480;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(143, 208, 220, 0.85)";
    ctx.fillStyle = "rgba(244, 234, 214, 0.9)";
    ctx.lineWidth = 2;
    landmarks.forEach(function (lm) {
      for (var i = 0; i < lm.length; i += 1) {
        var x = (state.mirrored ? 1 - lm[i].x : lm[i].x) * w;
        var y = lm[i].y * h;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function onHands(result) {
    var lms = (result && result.landmarks) || [];
    drawHands(lms);
    var cursor = $("vh-cursor");
    if (!lms.length) {
      if (cursor) cursor.style.display = "none";
      state.dwellId = "";
      return;
    }
    var lm = lms[0];
    var tip = lm[8];
    var nx = state.mirrored ? 1 - tip.x : tip.x;
    var ny = tip.y;
    if (cursor) {
      cursor.style.display = "block";
      cursor.style.left = nx * 100 + "%";
      cursor.style.top = ny * 100 + "%";
    }
    var key = hitKey(nx, ny);
    var now = performance.now();
    document.querySelectorAll(".vh-key").forEach(function (el) {
      el.classList.toggle("dwell", el.dataset.vhKey === key);
    });
    if (key) {
      if (state.dwellId !== key) {
        state.dwellId = key;
        state.dwellSince = now;
      } else if (now - state.dwellSince > 480) {
        appendLetter(key);
        state.dwellSince = now + 280;
      }
      return;
    }
    state.dwellId = "";
    var g = classifyGesture(lm);
    if (g === "SPEAK" && now - state.lastLetterAt > 900) {
      state.lastLetterAt = now;
      speak(state.buffer);
    }
  }

  function loop() {
    if (!state.running) return;
    var video = $("vh-video");
    if (state.landmarker && video && video.readyState >= 2) {
      try {
        var ts = performance.now();
        var result = state.landmarker.detectForVideo(video, ts);
        onHands(result);
      } catch (err) {}
    }
    state.raf = requestAnimationFrame(loop);
  }

  function loadHands() {
    if (state.landmarker) return Promise.resolve(state.landmarker);
    return import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm")
      .then(function (vision) {
        return vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        ).then(function (files) {
          return vision.HandLandmarker.createFromOptions(files, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.55,
            minTrackingConfidence: 0.5,
          });
        });
      })
      .then(function (lm) {
        state.landmarker = lm;
        return lm;
      });
  }

  function startCamera() {
    if (state.stream) {
      state.running = true;
      loop();
      return Promise.resolve();
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Camera not available — type or tap letters instead.");
      return Promise.resolve();
    }
    setStatus("Starting camera…");
    return navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(function (stream) {
        state.stream = stream;
        var video = $("vh-video");
        if (!video) return;
        video.srcObject = stream;
        video.muted = true;
        video.setAttribute("playsinline", "");
        return video.play();
      })
      .then(function () {
        return loadHands();
      })
      .then(function () {
        state.running = true;
        loop();
        setStatus("Point at a letter and hold. Open palm speaks. Record your voice on the right.");
      })
      .catch(function (err) {
        setStatus("Camera or hand tracker failed. You can still type and record. " + ((err && err.message) || ""));
      });
  }

  function stopCamera() {
    state.running = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) {
        t.stop();
      });
      state.stream = null;
    }
    var video = $("vh-video");
    if (video) video.srcObject = null;
  }

  function bind() {
    $("vh-cam") && $("vh-cam").addEventListener("click", function () {
      if (state.stream) {
        stopCamera();
        setStatus("Camera off.");
      } else {
        startCamera();
      }
    });
    $("vh-speak") && $("vh-speak").addEventListener("click", function () {
      speak(($("vh-buffer") && $("vh-buffer").value) || state.buffer);
    });
    $("vh-clear") && $("vh-clear").addEventListener("click", function () {
      setBuffer("");
    });
    $("vh-record") && $("vh-record").addEventListener("click", toggleRecord);
    $("vh-buffer") && $("vh-buffer").addEventListener("input", function (e) {
      state.buffer = e.target.value;
    });
    $("vh-upload") && $("vh-upload").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      var label = ($("vh-clip-label") && $("vh-clip-label").value) || file.name.replace(/\.[^.]+$/, "");
      var kind = ($("vh-clip-kind") && $("vh-clip-kind").value) || "reference";
      setStatus("Uploading…");
      uploadClip(file, label, kind)
        .then(function () {
          setStatus("Uploaded “" + label + "”.");
        })
        .catch(function () {
          setStatus("Upload failed.");
        });
    });
    window.addEventListener("voice-show", function () {
      loadClips();
      startCamera();
    });
    window.addEventListener("voice-hide", function () {
      stopCamera();
      if (state.recording && state.recorder) {
        try {
          state.recorder.stop();
        } catch (err) {}
      }
    });
  }

  function init() {
    if (!$("panel-voice")) return;
    buildKeys();
    buildPhrases();
    bind();
    loadClips();
    window.dispatchEvent(new Event("voice-ready"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.VoiceHands = {
    onShow: function () {
      loadClips();
      startCamera();
    },
    onHide: stopCamera,
    speak: speak,
    hasClips: function () {
      return state.clips.length > 0;
    },
  };
})();
