(function () {
  "use strict";

  var STORE_KEY = "l7in_server_last_v1";
  var CHANNEL_NAME = "l7in-server-v1";
  var PEER_TTL_MS = 12000;
  var POLL_MS = 3000;
  var DEDUPE_MS = 20000;
  var peers = {};
  var selfId = "";
  var channel = null;
  var timer = null;
  var shownAt = 0;
  var booted = false;
  var lastKey = "";
  var lastKeyAt = 0;
  var posting = false;
  var pendingBody = null;

  function $(id) {
    return document.getElementById(id);
  }

  function sessionId() {
    try {
      var id = sessionStorage.getItem("tabPresenceSid");
      if (id && id.length >= 8) return id;
    } catch (e) {}
    return "sw-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function currentTab() {
    var h = (location.hash || "").replace(/^#/, "").split("?")[0].toLowerCase();
    if (!h || h === "subscribe") return "gallery";
    if (h === "0-z" || h === "zeroz" || h === "0z") return "az";
    if (h === "kjv" || h === "scripture") return "bible";
    if (h === "rooms") return "places";
    return h.replace(/[^a-z0-9-]/g, "").slice(0, 40) || "gallery";
  }

  function onlineText(n) {
    n = parseInt(n, 10) || 0;
    if (n < 1) n = 1;
    return n + " online";
  }

  function localOnline() {
    var now = Date.now();
    var n = 1;
    for (var id in peers) {
      if (!Object.prototype.hasOwnProperty.call(peers, id)) continue;
      if (id === selfId) continue;
      if (now - peers[id] < PEER_TTL_MS) n += 1;
      else delete peers[id];
    }
    return n;
  }

  function paintOnline(n) {
    var el = $("server-window-online");
    if (!el) return;
    var next = onlineText(Math.max(localOnline(), parseInt(n, 10) || 0));
    if (el.textContent !== next) el.textContent = next;
  }

  function frame() {
    return document.querySelector("#server-window .server-window-frame");
  }

  function showImage(src, at, tab, quiet) {
    var root = $("server-window");
    var img = $("server-window-img");
    if (!root || !img || !src) return;
    at = at || Date.now();
    if (shownAt && at < shownAt) return;
    var changed = img.getAttribute("src") !== src;
    shownAt = at;
    img.alt = "Last generated";
    img.removeAttribute("hidden");
    if (changed) img.src = src;
    root.classList.add("has-image");
    var openBtn = $("server-window-open");
    if (openBtn) openBtn.hidden = false;
    var stageImg = $("server-window-stage-img");
    if (stageImg && changed) stageImg.src = src;
    if (tab) root.setAttribute("data-from", tab);
    if (booted && changed && !quiet) {
      var box = frame();
      if (box) {
        box.classList.remove("is-fresh");
        void box.offsetWidth;
        box.classList.add("is-fresh");
      }
    }
  }

  function remember(dataUrl, at, tab) {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ at: at, tab: tab || "", image: dataUrl })
      );
    } catch (e) {}
  }

  function recall() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (raw && raw.image && raw.at) showImage(raw.image, raw.at, raw.tab);
    } catch (e) {}
  }

  function postChannel(msg) {
    if (!channel) return;
    try {
      channel.postMessage(msg);
    } catch (e) {}
  }

  function sayHere() {
    peers[selfId] = Date.now();
    postChannel({ type: "here", id: selfId, at: peers[selfId] });
    paintOnline(0);
  }

  function keyOf(url) {
    url = String(url || "");
    if (url.length < 16) return "";
    return url.length + ":" + url.slice(-80);
  }

  function looksLikeStill(url) {
    url = String(url || "");
    if (!url || url.length < 16) return false;
    if (/^data:image\//i.test(url)) return true;
    if (/^blob:/i.test(url)) return true;
    if (/^https?:/i.test(url) && !/\.(mp4|webm|mov)(\?|$)/i.test(url)) return true;
    return false;
  }

  function thumbOf(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (/^https?:/i.test(url)) img.crossOrigin = "anonymous";
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width || 1;
          var h = img.naturalHeight || img.height || 1;
          var scale = Math.min(1, 320 / Math.max(w, h));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () {
        reject(new Error("image"));
      };
      img.src = url;
    });
  }

  function publish(dataUrl, at, tab, echo, quiet) {
    showImage(dataUrl, at, tab, quiet);
    remember(dataUrl, at, tab);
    if (!echo) {
      postChannel({ type: "image", id: selfId, at: at, tab: tab, image: dataUrl });
    }
  }

  function postStill(body) {
    pendingBody = body;
    if (posting) return;
    posting = true;
    function send() {
      var next = pendingBody;
      pendingBody = null;
      if (!next) {
        posting = false;
        return;
      }
      fetch("/api/server-window", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (data) {
          if (data && data.ok) {
            if (data.last && data.last.at && data.last.at >= shownAt) shownAt = data.last.at;
            paintOnline(data.online);
          }
        })
        .catch(function () {})
        .then(send);
    }
    send();
  }

  function share(url, meta) {
    url = String(url || "");
    if (!looksLikeStill(url)) return;
    var key = keyOf(url);
    var now = Date.now();
    if (key && key === lastKey && now - lastKeyAt < DEDUPE_MS) return;
    lastKey = key;
    lastKeyAt = now;
    meta = meta || {};
    var tab = String(meta.tab || currentTab() || "gallery")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40) || "gallery";
    showImage(url, now, tab);
    thumbOf(url).then(
      function (dataUrl) {
        if (!dataUrl || dataUrl.length < 32 || dataUrl.length > 140000) return;
        publish(dataUrl, Date.now(), tab, false, true);
        postStill({ image: dataUrl, tab: tab });
      },
      function () {
        if (/^https:\/\//i.test(url)) {
          showImage(url, now, tab);
          postChannel({ type: "remote", id: selfId, at: now, tab: tab, remote: url });
          postStill({ remote: url, tab: tab });
        }
      }
    );
  }

  function applyServer(data) {
    if (!data || !data.ok) return;
    paintOnline(data.online);
    var last = data.last;
    if (!last || !last.at || last.at <= shownAt) return;
    if (last.remote && !last.image) {
      showImage(last.remote, last.at, last.tab);
      return;
    }
    if (!last.image) return;
    fetch("/api/server-window?image=1&v=" + last.at, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("still");
        return r.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onload = function () {
            resolve(reader.result);
          };
          reader.onerror = function () {
            resolve("");
          };
          reader.readAsDataURL(blob);
        });
      })
      .then(function (dataUrl) {
        if (!dataUrl) return;
        publish(dataUrl, last.at, last.tab, true);
      })
      .catch(function () {});
  }

  function poll() {
    if (document.hidden) return;
    fetch("/api/server-window", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(applyServer)
      .catch(function () {
        paintOnline(0);
      });
  }

  function noteResponse(input, res) {
    var url = "";
    try {
      url = typeof input === "string" ? input : (input && input.url) || String(input || "");
    } catch (e) {
      return;
    }
    if (!/\/api\/jobs\/|\/api\/generate-stasis-vision|job-status/.test(url)) return;
    if (!res || !res.ok) return;
    var copy;
    try {
      copy = res.clone();
    } catch (e2) {
      return;
    }
    copy
      .json()
      .then(function (job) {
        if (!job || job.moderated) return;
        if (job.status && job.status !== "done") return;
        var img = job.image || (job.images && job.images[0]);
        var src = img && (img.url || img.remote_url);
        if (src) share(src, { tab: currentTab() });
      })
      .catch(function () {});
  }

  function installFetch() {
    if (!window.fetch || window.fetch.__l7inServer) return;
    var orig = window.fetch;
    var wrapped = function (input, init) {
      return orig.apply(this, arguments).then(function (res) {
        try {
          noteResponse(input, res);
        } catch (e) {}
        return res;
      });
    };
    wrapped.__l7inServer = true;
    window.fetch = wrapped;
  }

  function onPeer(msg) {
    if (!msg || msg.id === selfId) return;
    if (msg.type === "here" || msg.type === "bye") {
      if (msg.type === "bye") delete peers[msg.id];
      else peers[msg.id] = msg.at || Date.now();
      paintOnline(0);
      return;
    }
    if (msg.type === "image" && msg.image) {
      peers[msg.id] = Date.now();
      if (!msg.at || msg.at > shownAt) publish(msg.image, msg.at || Date.now(), msg.tab, true);
      paintOnline(0);
      return;
    }
    if (msg.type === "remote" && msg.remote && (!msg.at || msg.at > shownAt)) {
      showImage(msg.remote, msg.at || Date.now(), msg.tab);
    }
  }

  function bindChannel() {
    if (typeof BroadcastChannel !== "function") return;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = function (ev) {
        onPeer(ev.data);
      };
    } catch (e) {
      channel = null;
    }
  }

  function onGenerated(ev) {
    var detail = (ev && ev.detail) || {};
    share(detail.imageUrl || detail.url || detail.src || "", {
      tab: detail.tab || currentTab(),
    });
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function start() {
    stop();
    sayHere();
    if (!document.hidden) poll();
    timer = setInterval(function () {
      sayHere();
      if (!document.hidden) poll();
    }, POLL_MS);
  }

  function stageEl() {
    var stage = $("server-window-stage");
    if (stage) return stage;
    stage = document.createElement("div");
    stage.id = "server-window-stage";
    stage.className = "server-window-stage";
    stage.hidden = true;
    stage.setAttribute("role", "dialog");
    stage.setAttribute("aria-modal", "true");
    stage.setAttribute("aria-label", "Last generated, full screen");
    var img = document.createElement("img");
    img.id = "server-window-stage-img";
    img.alt = "Last generated";
    var close = document.createElement("p");
    close.className = "server-window-stage-close";
    close.textContent = "Close";
    stage.appendChild(img);
    stage.appendChild(close);
    document.body.appendChild(stage);
    stage.addEventListener("click", closeStage);
    return stage;
  }

  function openStage() {
    var img = $("server-window-img");
    var src = img && !img.hidden && img.getAttribute("src");
    if (!src) return;
    var stage = stageEl();
    var big = $("server-window-stage-img");
    if (big.getAttribute("src") !== src) big.src = src;
    stage.hidden = false;
    stage.classList.add("is-open");
    document.body.classList.add("server-stage-open");
    var req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (req) {
      try {
        var pending = req.call(stage);
        if (pending && pending.catch) pending.catch(function () {});
      } catch (e) {}
    }
  }

  function closeStage() {
    var stage = $("server-window-stage");
    if (!stage) return;
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs === stage) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        try {
          var pending = exit.call(document);
          if (pending && pending.catch) pending.catch(function () {});
        } catch (e) {}
      }
    }
    stage.classList.remove("is-open");
    stage.hidden = true;
    document.body.classList.remove("server-stage-open");
  }

  function onFullscreenChange() {
    var stage = $("server-window-stage");
    if (!stage || !stage.classList.contains("is-open")) return;
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs === stage) {
      stage.dataset.wentFull = "1";
      return;
    }
    if (!stage.dataset.wentFull) return;
    delete stage.dataset.wentFull;
    closeStage();
  }

  function init() {
    selfId = sessionId();
    installFetch();
    bindChannel();
    recall();
    booted = true;
    paintOnline(1);
    start();
    var openBtn = $("server-window-open");
    if (openBtn) openBtn.addEventListener("click", openStage);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeStage();
    });
    window.addEventListener("spellforge-job-done", onGenerated);
    window.addEventListener("fi-generated-new", onGenerated);
    window.addEventListener("l7in-generated", onGenerated);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) poll();
    });
    window.addEventListener("pagehide", function () {
      postChannel({ type: "bye", id: selfId });
    });
  }

  window.L7inServer = { share: share };
  installFetch();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
