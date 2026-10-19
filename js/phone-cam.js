/**
 * Logan's phone camera. While it is on, the picture goes live on the site
 * and floats on every open page, including a desktop. The picture is not saved.
 * Audio is never captured. The public name is never read or changed.
 * This phone is marked by opening #phone-cam once, or by the signed-in artist account.
 */
(function () {
  "use strict";

  var SET_KEY = "l7in_phone_cam_v1";
  var POS_KEY = "l7in_phone_cam_pos_v1";
  var FACE_KEY = "l7in_phone_cam_face_v1";
  var MINE_KEY = "l7in_phone_cam_mine_v1";
  var PUB_KEY = "l7in_phone_cam_pub_v1";
  var ARTIST_EMAIL = "lsevin71@gmail.com";
  var root = null;
  var video = null;
  var note = null;
  var stream = null;
  var facing = "user";
  var drag = null;
  var request = 0;
  var canvas = null;
  var posting = false;
  var publishTimer = 0;
  var pollTimer = 0;
  var shownAt = 0;
  var liveNote = "";

  function norm(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function rememberMine() {
    try { localStorage.setItem(MINE_KEY, "1"); } catch (e) {}
  }

  function mineFlag() {
    try { return localStorage.getItem(MINE_KEY) === "1"; } catch (e) { return false; }
  }

  function publisherId() {
    var cur = "";
    try { cur = localStorage.getItem(PUB_KEY) || ""; } catch (e) { cur = ""; }
    if (/^[A-Za-z0-9]{16,40}$/.test(cur)) return cur;
    var next = "";
    try {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      next = Array.from(bytes).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    } catch (e2) {
      next = String(Date.now()) + String(Math.random()).replace(/\D/g, "");
    }
    next = next.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
    while (next.length < 16) next += "0";
    try { localStorage.setItem(PUB_KEY, next); } catch (e3) {}
    return next;
  }

  function claimFromAddress() {
    var url;
    try { url = new URL(location.href); } catch (e) { return false; }
    var hash = (url.hash || "").replace(/^#/, "").split("?")[0].toLowerCase();
    var fromQuery = url.searchParams.get("phone-cam") === "1";
    var fromHash = hash === "phone-cam";
    if (!fromQuery && !fromHash) return false;
    rememberMine();
    if (fromQuery) url.searchParams.delete("phone-cam");
    if (fromHash) url.hash = "";
    try { history.replaceState(null, "", url.pathname + url.search + url.hash); } catch (e2) {}
    return true;
  }

  function isOwner() {
    if (mineFlag()) return true;
    try {
      var user = window.AccountGate && AccountGate.getUser && AccountGate.getUser();
      if (user && norm(user.email) === ARTIST_EMAIL) return true;
    } catch (e2) {}
    return false;
  }

  function settingOn() {
    try { return localStorage.getItem(SET_KEY) === "1"; } catch (e) { return false; }
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
    try { localStorage.setItem(FACE_KEY, facing); } catch (e) {}
  }

  function mark(state) {
    document.documentElement.dataset.phoneCam = state;
  }

  function stopPublish() {
    if (publishTimer) clearInterval(publishTimer);
    publishTimer = 0;
    posting = false;
  }

  function stopStream() {
    request += 1;
    stopPublish();
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  function setNote(text) {
    liveNote = text || "";
    if (note) note.textContent = liveNote;
  }

  function bottomInset() {
    if (window.innerWidth > 640) return 8;
    var hud = document.getElementById("money-hud");
    if (!hud) return 96;
    var rect = hud.getBoundingClientRect();
    if (rect.height < 8) return 96;
    return Math.max(8, window.innerHeight - rect.top + 10);
  }

  function place(left, top) {
    if (!root) return;
    var rect = root.getBoundingClientRect();
    var width = rect.width || 200;
    var height = rect.height || 48;
    var inset = bottomInset();
    var maxLeft = Math.max(8, window.innerWidth - width - 8);
    var maxTop = Math.max(8, window.innerHeight - height - inset);
    left = Math.min(maxLeft, Math.max(8, left));
    top = Math.min(maxTop, Math.max(8, top));
    root.style.left = left + "px";
    root.style.right = "auto";
    root.style.top = top + "px";
    root.style.bottom = "auto";
    root.classList.add("is-placed");
  }

  function park() {
    if (!root || root.classList.contains("is-placed")) return;
    if (window.innerWidth > 640) {
      root.style.left = "";
      root.style.right = "";
      root.style.top = "";
      root.style.bottom = "";
      return;
    }
    root.style.left = "auto";
    root.style.top = "auto";
    root.style.right = "8px";
    root.style.bottom = bottomInset() + "px";
  }

  function settle() {
    if (!root) return;
    if (root.classList.contains("is-placed")) {
      var rect = root.getBoundingClientRect();
      place(rect.left, rect.top);
    } else park();
  }

  function savePos() {
    if (!root || !root.classList.contains("is-placed")) return;
    var rect = root.getBoundingClientRect();
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
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
    if (!root || root.dataset.role !== "owner") return;
    root.classList.toggle("is-on", settingOn());
  }

  function frameUrl() {
    if (!video || !video.videoWidth || !video.videoHeight) return "";
    if (!canvas) canvas = document.createElement("canvas");
    var scale = Math.min(1, 360 / video.videoWidth);
    var w = Math.max(2, Math.round(video.videoWidth * scale));
    var h = Math.max(2, Math.round(video.videoHeight * scale));
    if (h > 640) {
      w = Math.max(2, Math.round(w * (640 / h)));
      h = 640;
    }
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0, w, h);
    try { return canvas.toDataURL("image/jpeg", 0.58); } catch (e) { return ""; }
  }

  function postLive(body) {
    return fetch("/api/phone-live", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (data) {
        return { status: r.status, data: data };
      }).catch(function () { return { status: r.status, data: null }; });
    }).catch(function () { return null; });
  }

  function publishOnce() {
    if (posting || document.hidden || !isOwner() || !settingOn() || !stream) return;
    var image = frameUrl();
    if (!image) return;
    posting = true;
    postLive({ image: image, publisher: publisherId() }).then(function (res) {
      posting = false;
      if (!settingOn() || !stream) return;
      if (res && res.data && res.data.ok) {
        if (liveNote) setNote("");
        return;
      }
      if (liveNote) return;
      setNote(res && res.status === 409 ? "Someone else is live." : "The live picture did not reach the site.");
    });
  }

  function watchPublish() {
    if (publishTimer) return;
    publishTimer = setInterval(publishOnce, 450);
    publishOnce();
  }

  function endLive() {
    var body = JSON.stringify({ off: true, publisher: publisherId() });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/phone-live", new Blob([body], { type: "application/json" }));
        return;
      }
    } catch (e) {}
    postLive({ off: true, publisher: publisherId() });
  }

  function start() {
    if (!root || root.dataset.role !== "owner" || !isOwner() || !settingOn()) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setNote("This browser has no camera.");
      return;
    }
    if (stream && video && video.srcObject === stream) {
      var current = stream.getVideoTracks()[0];
      var mode = current && current.getSettings ? current.getSettings().facingMode : "";
      if (!mode || mode === facing) {
        watchPublish();
        return;
      }
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
      clearRemote();
      setNote("");
      settle();
      watchPublish();
    }).catch(function () {
      if (token !== request) return;
      setNote("The camera did not start. Tap the picture.");
    });
  }

  function bindDrag() {
    if (!root || root.dataset.dragBound) return;
    root.dataset.dragBound = "1";
    root.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
      var rect = root.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
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

  function bindOwner() {
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
      endLive();
      setNote("");
      clearRemote();
      paint();
    });
    video.addEventListener("click", function () {
      if (settingOn() && !stream) start();
    });
    bindDrag();
  }

  function ensureOwner() {
    if (root && root.dataset.role === "owner") return;
    if (root) shutdown();
    root = document.createElement("div");
    root.id = "phone-cam";
    root.className = "phone-cam";
    root.dataset.role = "owner";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Live camera");
    root.innerHTML =
      '<button type="button" class="phone-cam-toggle" aria-label="Go live" title="Go live on the site. The picture shows on every open page.">Go live</button>' +
      '<video class="phone-cam-view" autoplay muted playsinline aria-label="Live camera"></video>' +
      '<p class="phone-cam-note" role="status"></p>' +
      '<div class="phone-cam-bar">' +
      '<button type="button" class="phone-cam-flip" title="Switch front and back camera">Flip</button>' +
      '<button type="button" class="phone-cam-off" title="Turn the phone camera off">Off</button>' +
      "</div>";
    document.body.appendChild(root);
    video = root.querySelector("video");
    note = root.querySelector(".phone-cam-note");
    if (liveNote) note.textContent = liveNote;
    bindOwner();
    restorePos();
  }

  function ensureViewer() {
    if (root && root.dataset.role === "viewer") {
      root.classList.add("is-live");
      return;
    }
    if (root) shutdown();
    root = document.createElement("div");
    root.id = "phone-cam";
    root.className = "phone-cam is-live";
    root.dataset.role = "viewer";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Live camera");
    root.innerHTML = '<img class="phone-cam-view" alt="Live">';
    document.body.appendChild(root);
    video = null;
    note = null;
    bindDrag();
    restorePos();
  }

  function clearRemote() {
    shownAt = 0;
    if (!root || root.dataset.role !== "owner") return;
    root.classList.remove("is-live", "is-remote");
    var img = root.querySelector(".phone-cam-remote");
    if (img) img.remove();
  }

  function shutdown() {
    stopStream();
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    video = null;
    note = null;
  }

  function showRemote(at) {
    var src = "/api/phone-live?frame=1&v=" + at;
    if (isOwner()) {
      ensureOwner();
      paint();
      root.classList.add("is-live", "is-remote");
      var img = root.querySelector(".phone-cam-remote");
      if (!img) {
        img = document.createElement("img");
        img.className = "phone-cam-view phone-cam-remote";
        img.alt = "Live";
        root.insertBefore(img, root.firstChild);
      }
      if (img.getAttribute("src") !== src) img.src = src;
      settle();
      return;
    }
    ensureViewer();
    var view = root.querySelector("img");
    if (view && view.getAttribute("src") !== src) view.src = src;
    settle();
  }

  function applyRemote(data) {
    var live = !!(data && data.ok && data.live && data.at);
    var local = !!(isOwner() && settingOn() && stream);
    if (local) {
      clearRemote();
      return;
    }
    if (!live) {
      if (root && root.dataset.role === "viewer") shutdown();
      else clearRemote();
      return;
    }
    if (data.at === shownAt && root && root.classList.contains("is-live")) return;
    shownAt = data.at;
    showRemote(data.at);
  }

  function pullLive() {
    if (document.hidden) return;
    fetch("/api/phone-live", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(applyRemote)
      .catch(function () {});
  }

  function watchLive() {
    if (pollTimer) return;
    pollTimer = setInterval(pullLive, 1000);
    pullLive();
  }

  function sync() {
    claimFromAddress();
    if (isOwner()) {
      if (root && root.dataset.role === "viewer") shutdown();
      loadFacing();
      ensureOwner();
      paint();
      settle();
      mark("owner");
      if (settingOn()) start();
      else stopStream();
    } else {
      stopStream();
      if (root && root.dataset.role === "owner") shutdown();
      mark("guest");
    }
    watchLive();
  }

  window.addEventListener("hashchange", function () {
    if (claimFromAddress()) sync();
  });
  window.addEventListener("storage", function (e) {
    if (!e.key || e.key === MINE_KEY || e.key === SET_KEY) sync();
  });
  window.addEventListener("resize", settle);
  window.addEventListener("pagehide", function () {
    if (isOwner() && settingOn()) endLive();
    stopStream();
  });
  window.addEventListener("pageshow", function () {
    if (isOwner() && settingOn()) start();
    pullLive();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stopPublish();
      return;
    }
    if (isOwner() && settingOn()) start();
    pullLive();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync);
  else sync();
})();
