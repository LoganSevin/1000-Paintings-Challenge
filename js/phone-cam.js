/**
 * Logan's phone camera, floating on every tab while the setting is on.
 * The picture stays in this browser. It is not uploaded and not shown to guests.
 * The switch is on this page only when the saved name is Logan, or the signed-in
 * account is the artist's.
 */
(function () {
  "use strict";

  var SET_KEY = "l7in_phone_cam_v1";
  var POS_KEY = "l7in_phone_cam_pos_v1";
  var FACE_KEY = "l7in_phone_cam_face_v1";
  var ARTIST_EMAIL = "lsevin71@gmail.com";
  var root = null;
  var video = null;
  var note = null;
  var stream = null;
  var facing = "user";
  var drag = null;
  var request = 0;

  function norm(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function savedName() {
    var input = document.getElementById("page-chat-name");
    if (input && document.activeElement === input) {
      var live = norm(input.value);
      if (live) return live;
    }
    try {
      return norm(localStorage.getItem("pageChatName") || "");
    } catch (e) {
      return "";
    }
  }

  function isOwner() {
    var name = savedName();
    if (/^logan(?:\b|7)/.test(name)) return true;
    try {
      var user = window.AccountGate && AccountGate.getUser && AccountGate.getUser();
      if (user && norm(user.email) === ARTIST_EMAIL) return true;
    } catch (e2) {}
    return false;
  }

  function settingOn() {
    try {
      return localStorage.getItem(SET_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setSetting(on) {
    try {
      if (on) localStorage.setItem(SET_KEY, "1");
      else localStorage.removeItem(SET_KEY);
    } catch (e) {}
  }

  function loadFacing() {
    try {
      var saved = localStorage.getItem(FACE_KEY);
      if (saved === "environment" || saved === "user") facing = saved;
    } catch (e) {}
  }

  function saveFacing() {
    try {
      localStorage.setItem(FACE_KEY, facing);
    } catch (e) {}
  }

  function mark(state) {
    document.documentElement.dataset.phoneCam = state;
  }

  function stopStream() {
    request += 1;
    if (stream) {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  function setNote(text) {
    if (note) note.textContent = text || "";
  }

  function place(left, top) {
    if (!root) return;
    var rect = root.getBoundingClientRect();
    var width = rect.width || 152;
    var height = rect.height || 48;
    var maxLeft = Math.max(8, window.innerWidth - width - 8);
    var maxTop = Math.max(8, window.innerHeight - height - 8);
    left = Math.min(maxLeft, Math.max(8, left));
    top = Math.min(maxTop, Math.max(8, top));
    root.style.left = left + "px";
    root.style.top = top + "px";
    root.style.bottom = "auto";
    root.classList.add("is-placed");
  }

  function savePos() {
    if (!root || !root.classList.contains("is-placed")) return;
    var rect = root.getBoundingClientRect();
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({
        left: rect.left,
        top: rect.top,
      }));
    } catch (e) {}
  }

  function restorePos() {
    try {
      var saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (!saved || typeof saved.left !== "number" || typeof saved.top !== "number") return;
      place(saved.left, saved.top);
    } catch (e) {}
  }

  function paint() {
    if (!root) return;
    root.classList.toggle("is-on", settingOn());
  }

  function start() {
    if (!root || !isOwner() || !settingOn()) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setNote("This browser has no camera.");
      return;
    }
    if (stream && video && video.srcObject === stream) {
      var current = stream.getVideoTracks()[0];
      var mode = current && current.getSettings ? current.getSettings().facingMode : "";
      if (!mode || mode === facing) return;
    }
    var previous = stream;
    stream = null;
    if (video) video.srcObject = null;
    if (previous) previous.getTracks().forEach(function (track) { track.stop(); });
    var token = ++request;
    var wanted = facing;
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: wanted } },
    }).then(function (next) {
      if (token !== request || !settingOn() || !isOwner() || wanted !== facing) {
        next.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      stream = next;
      if (video) {
        video.srcObject = next;
        var play = video.play();
        if (play && play.catch) play.catch(function () {});
      }
      setNote("");
    }).catch(function () {
      if (token !== request) return;
      setNote("The camera did not start. Tap the picture.");
    });
  }

  function bind() {
    root.querySelector(".phone-cam-toggle").addEventListener("click", function () {
      setSetting(true);
      paint();
      start();
    });
    root.querySelector(".phone-cam-flip").addEventListener("click", function () {
      facing = facing === "user" ? "environment" : "user";
      saveFacing();
      stopStream();
      start();
    });
    root.querySelector(".phone-cam-off").addEventListener("click", function () {
      setSetting(false);
      stopStream();
      setNote("");
      paint();
    });
    video.addEventListener("click", function () {
      if (settingOn() && !stream) start();
    });
    root.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
      var rect = root.getBoundingClientRect();
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: rect.left,
        top: rect.top,
      };
      try { root.setPointerCapture(e.pointerId); } catch (err) {}
    });
    root.addEventListener("pointermove", function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      place(drag.left + (e.clientX - drag.x), drag.top + (e.clientY - drag.y));
    });
    function endDrag(e) {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      savePos();
    }
    root.addEventListener("pointerup", endDrag);
    root.addEventListener("pointercancel", endDrag);
  }

  function ensure() {
    if (root) return;
    root = document.createElement("div");
    root.id = "phone-cam";
    root.className = "phone-cam";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Phone camera");
    root.innerHTML =
      '<button type="button" class="phone-cam-toggle" title="Show your phone camera on every tab. It stays on your screen.">Phone camera</button>' +
      '<video class="phone-cam-view" autoplay muted playsinline aria-label="Your phone camera"></video>' +
      '<p class="phone-cam-note" role="status"></p>' +
      '<div class="phone-cam-bar">' +
      '<button type="button" class="phone-cam-flip" title="Switch front and back camera">Flip</button>' +
      '<button type="button" class="phone-cam-off" title="Turn the phone camera off">Off</button>' +
      "</div>";
    document.body.appendChild(root);
    video = root.querySelector("video");
    note = root.querySelector(".phone-cam-note");
    bind();
    restorePos();
  }

  function shutdown() {
    stopStream();
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    video = null;
    note = null;
  }

  function sync() {
    if (!isOwner()) {
      shutdown();
      mark("guest");
      return;
    }
    loadFacing();
    ensure();
    paint();
    mark("owner");
    if (settingOn()) start();
    else stopStream();
  }

  window.addEventListener("page-chat-name", sync);
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "page-chat-name") sync();
  });
  window.addEventListener("storage", function (e) {
    if (!e.key || e.key === "pageChatName" || e.key === SET_KEY) sync();
  });
  window.addEventListener("resize", function () {
    if (root && root.classList.contains("is-placed")) place(root.offsetLeft, root.offsetTop);
  });
  window.addEventListener("pagehide", stopStream);
  window.addEventListener("pageshow", function () {
    if (isOwner() && settingOn()) start();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync);
  else sync();
})();
