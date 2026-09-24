(function () {
  "use strict";

  var NAME_KEY = "pageChatName";
  var COLLAPSE_KEY = "pageChatCollapsed";
  var POLL_MS = 4000;
  var MAX_TEXT = 280;
  var ROOM_RE = /^[a-z0-9-]{1,40}$/;

  var root = null;
  var logEl = null;
  var nameInput = null;
  var textInput = null;
  var sendBtn = null;
  var statusEl = null;
  var roomEl = null;
  var badgeEl = null;
  var toggleBtn = null;

  var room = "gallery";
  var messages = [];
  var lastTs = 0;
  var pollTimer = null;
  var stickBottom = true;
  var posting = false;
  var unseen = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function hashTab() {
    var h = (location.hash || "").replace(/^#/, "").split("?")[0];
    if (!h || h === "subscribe") return "gallery";
    if (h === "0-z" || h === "zeroz" || h === "0z") return "az";
    if (h === "kjv" || h === "scripture") return "bible";
    if (h === "rooms") return "places";
    return h;
  }

  function defaultName() {
    return "guest-" + String(Math.floor(1000 + Math.random() * 9000));
  }

  function loadName() {
    try {
      var n = localStorage.getItem(NAME_KEY);
      if (n && String(n).trim()) return String(n).trim().slice(0, 32);
    } catch (e) {}
    var d = defaultName();
    try {
      localStorage.setItem(NAME_KEY, d);
    } catch (e2) {}
    return d;
  }

  function saveName(n) {
    try {
      localStorage.setItem(NAME_KEY, String(n || "").trim().slice(0, 32));
    } catch (e) {}
  }

  function isCollapsed() {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") return true;
      if (localStorage.getItem(COLLAPSE_KEY) === "0") return false;
    } catch (e) {}
    return window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
  }

  function setCollapsed(v) {
    if (!root) return;
    root.classList.toggle("is-collapsed", !!v);
    if (toggleBtn) {
      toggleBtn.textContent = v ? "+" : "–";
      toggleBtn.title = v ? "Expand page chat" : "Minimize page chat";
      toggleBtn.setAttribute("aria-expanded", v ? "false" : "true");
    }
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
    } catch (e) {}
    if (!v) {
      unseen = 0;
      updateBadge();
      scrollIfStuck();
    }
  }

  function updateBadge() {
    if (!badgeEl) return;
    badgeEl.textContent = unseen > 0 ? String(unseen) : "";
    badgeEl.setAttribute("data-count", String(unseen || 0));
  }

  function relTime(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("is-ok", !!ok);
  }

  function buildDom() {
    if ($("page-chat")) return $("page-chat");
    var el = document.createElement("aside");
    el.id = "page-chat";
    el.className = "page-chat";
    el.setAttribute("aria-label", "Page chat");
    el.innerHTML =
      '<div class="page-chat-head" id="page-chat-head">' +
      '<span class="page-chat-title">page chat <span class="page-chat-room" id="page-chat-room"></span></span>' +
      '<span class="page-chat-badge" id="page-chat-badge" data-count="0"></span>' +
      '<button type="button" class="page-chat-toggle" id="page-chat-toggle" aria-label="Toggle page chat">–</button>' +
      "</div>" +
      '<div class="page-chat-body" id="page-chat-log" role="log" aria-live="polite"></div>' +
      '<form class="page-chat-compose" id="page-chat-form" autocomplete="off">' +
      '<div class="page-chat-name-row">' +
      '<label for="page-chat-name">Name</label>' +
      '<input id="page-chat-name" type="text" maxlength="32" spellcheck="false" />' +
      "</div>" +
      '<div class="page-chat-send-row">' +
      '<input id="page-chat-text" type="text" maxlength="' +
      MAX_TEXT +
      '" placeholder="Say something…" />' +
      '<button type="submit" class="page-chat-send" id="page-chat-send">Send</button>' +
      "</div>" +
      '<div class="page-chat-status" id="page-chat-status" aria-live="polite"></div>' +
      "</form>";
    document.body.appendChild(el);
    return el;
  }

  function renderAll() {
    if (!logEl) return;
    logEl.textContent = "";
    if (!messages.length) {
      var empty = document.createElement("p");
      empty.className = "page-chat-empty";
      empty.textContent = "No messages yet — say hi.";
      logEl.appendChild(empty);
      return;
    }
    var frag = document.createDocumentFragment();
    messages.forEach(function (m) {
      frag.appendChild(msgNode(m));
    });
    logEl.appendChild(frag);
    scrollIfStuck();
  }

  function msgNode(m) {
    var row = document.createElement("div");
    row.className = "page-chat-msg";
    row.dataset.id = m.id;

    var meta = document.createElement("div");
    meta.className = "page-chat-msg-meta";

    var name = document.createElement("span");
    name.className = "page-chat-name";
    name.textContent = m.name || "guest";

    var time = document.createElement("span");
    time.className = "page-chat-time";
    time.dataset.ts = String(m.ts || 0);
    time.textContent = relTime(m.ts || 0);
    time.title = new Date(m.ts || 0).toLocaleString();

    meta.appendChild(name);
    meta.appendChild(time);

    var text = document.createElement("p");
    text.className = "page-chat-text";
    text.textContent = m.text || "";

    row.appendChild(meta);
    row.appendChild(text);
    return row;
  }

  function refreshTimes() {
    if (!logEl) return;
    logEl.querySelectorAll(".page-chat-time").forEach(function (el) {
      var ts = parseInt(el.dataset.ts, 10) || 0;
      el.textContent = relTime(ts);
    });
  }

  function scrollIfStuck() {
    if (!logEl || !stickBottom) return;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function mergeMessages(incoming, fromPoll) {
    if (!Array.isArray(incoming) || !incoming.length) return;
    var byId = {};
    messages.forEach(function (m) {
      byId[m.id] = m;
    });
    var added = 0;
    incoming.forEach(function (raw) {
      if (!raw || !raw.id) return;
      var entry = {
        id: String(raw.id).slice(0, 48),
        name: String(raw.name || "guest").slice(0, 32),
        text: String(raw.text || "").slice(0, MAX_TEXT),
        ts: parseInt(raw.ts, 10) || 0,
      };
      if (!entry.text || !entry.ts) return;
      if (!byId[entry.id]) {
        byId[entry.id] = entry;
        added += 1;
      }
    });
    messages = Object.keys(byId)
      .map(function (k) {
        return byId[k];
      })
      .sort(function (a, b) {
        return a.ts - b.ts;
      });
    if (messages.length) lastTs = messages[messages.length - 1].ts;
    renderAll();
    if (fromPoll && added > 0 && root && root.classList.contains("is-collapsed")) {
      unseen += added;
      updateBadge();
    }
  }

  function resetRoom(next) {
    room = ROOM_RE.test(next) ? next : "gallery";
    messages = [];
    lastTs = 0;
    unseen = 0;
    updateBadge();
    if (roomEl) roomEl.textContent = "#" + room;
    renderAll();
    fetchMessages(false);
  }

  function fetchMessages(incremental) {
    if (document.hidden) return Promise.resolve();
    var q = "/api/page-chat?room=" + encodeURIComponent(room);
    if (incremental && lastTs) q += "&since=" + encodeURIComponent(String(lastTs));
    return fetch(q, { cache: "no-store" })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (pack) {
        var data = pack.data || {};
        if (!data.ok) return;
        if (!incremental) {
          messages = [];
          lastTs = 0;
        }
        mergeMessages(data.messages || [], incremental);
      })
      .catch(function () {
        /* quiet — offline / function not yet deployed */
      });
  }

  function schedulePoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      fetchMessages(true);
      refreshTimes();
    }, POLL_MS);
  }

  function postMessage(ev) {
    if (ev) ev.preventDefault();
    if (posting) return;
    var name = (nameInput && nameInput.value ? nameInput.value : "").trim().slice(0, 32) || loadName();
    var text = (textInput && textInput.value ? textInput.value : "").trim().slice(0, MAX_TEXT);
    if (!text) {
      setStatus("Type a message first.");
      return;
    }
    saveName(name);
    if (nameInput) nameInput.value = name;
    posting = true;
    if (sendBtn) sendBtn.disabled = true;
    setStatus("Sending…");
    fetch("/api/page-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: room, name: name, text: text }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (pack) {
        var data = pack.data || {};
        if (pack.res.status === 429) {
          setStatus(data.error || "Slow down a second.");
          return;
        }
        if (!data.ok) {
          setStatus(data.error || "Could not send.");
          return;
        }
        if (textInput) textInput.value = "";
        stickBottom = true;
        if (data.message) mergeMessages([data.message], false);
        setStatus("Sent", true);
        setTimeout(function () {
          setStatus("");
        }, 1200);
      })
      .catch(function () {
        setStatus("Network error — try again.");
      })
      .finally(function () {
        posting = false;
        if (sendBtn) sendBtn.disabled = false;
      });
  }

  function bind() {
    root = buildDom();
    logEl = $("page-chat-log");
    nameInput = $("page-chat-name");
    textInput = $("page-chat-text");
    sendBtn = $("page-chat-send");
    statusEl = $("page-chat-status");
    roomEl = $("page-chat-room");
    badgeEl = $("page-chat-badge");
    toggleBtn = $("page-chat-toggle");
    var head = $("page-chat-head");
    var form = $("page-chat-form");

    if (nameInput) nameInput.value = loadName();
    setCollapsed(isCollapsed());

    if (toggleBtn) {
      toggleBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        setCollapsed(!root.classList.contains("is-collapsed"));
      });
    }
    if (head) {
      head.addEventListener("click", function (e) {
        if (e.target === toggleBtn || (toggleBtn && toggleBtn.contains(e.target))) return;
        if (root.classList.contains("is-collapsed")) setCollapsed(false);
      });
    }
    if (form) form.addEventListener("submit", postMessage);

    if (logEl) {
      logEl.addEventListener("scroll", function () {
        var gap = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight;
        stickBottom = gap < 28;
      });
    }

    if (nameInput) {
      nameInput.addEventListener("change", function () {
        saveName(nameInput.value);
      });
    }

    window.addEventListener("tab-changed", function (e) {
      var next = (e && e.detail && e.detail.tab) || hashTab();
      if (next !== room) resetRoom(next);
    });

    window.addEventListener("hashchange", function () {
      var next = hashTab();
      if (next !== room) resetRoom(next);
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) fetchMessages(true);
    });
  }

  function init() {
    bind();
    resetRoom(hashTab());
    schedulePoll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
