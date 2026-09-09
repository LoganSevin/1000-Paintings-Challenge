/**
 * Chat — studio Grok on the same xAI key as generate.
 */
(function () {
  "use strict";

  var STORAGE = "gallery.studio-chat.v1";
  var state = { messages: [], busy: false };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if (raw && Array.isArray(raw.messages)) state.messages = raw.messages.slice(-40);
    } catch (e) {
      state.messages = [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ messages: state.messages.slice(-40) }));
    } catch (e) {}
  }

  function emitChat(role, content) {
    try {
      window.dispatchEvent(
        new CustomEvent("studio-chat", { detail: { role: role, content: content } })
      );
    } catch (e) {}
  }

  function ingest(role, content) {
    var text = String(content || "").trim();
    if (!text) return;
    var r = role === "assistant" ? "assistant" : "user";
    state.messages.push({ role: r, content: text.slice(0, 4000) });
    save();
    render();
    emitChat(r, text);
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function setStatus(msg, kind) {
    var el = $("ch-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "ch-status" + (kind === "err" ? " err" : "");
  }

  function render() {
    var log = $("ch-log");
    if (!log) return;
    if (!state.messages.length) {
      log.innerHTML =
        '<p class="ch-empty">Ask about a painting, a Demand brief, Transfer, Puzzle, Saccade, or what to build next. Same xAI account as generate.</p>';
      return;
    }
    log.innerHTML = state.messages
      .map(function (m) {
        var role = m.role === "user" ? "user" : "assistant";
        return '<div class="ch-msg ' + role + '">' + escapeHtml(m.content) + "</div>";
      })
      .join("");
    log.scrollTop = log.scrollHeight;
  }

  function send() {
    var input = $("ch-input");
    if (!input) return;
    var text = String(input.value || "").trim();
    if (!text) return;
    input.value = "";
    sendText(text);
  }

  function sendText(text) {
    text = String(text || "").trim();
    if (!text || state.busy) return false;
    var btn = $("ch-send");
    var input = $("ch-input");
    state.messages.push({ role: "user", content: text });
    save();
    render();
    emitChat("user", text);
    state.busy = true;
    if (btn) btn.disabled = true;
    setStatus("Thinking…");
    var pending = document.createElement("div");
    pending.className = "ch-msg assistant pending";
    pending.textContent = "…";
    var log = $("ch-log");
    if (log) {
      log.appendChild(pending);
      log.scrollTop = log.scrollHeight;
    }
    fetch(apiUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages.slice(-20) }),
    })
      .then(function (r) {
        return r.text().then(function (raw) {
          var d = {};
          try {
            d = raw ? JSON.parse(raw) : {};
          } catch (e) {
            throw new Error(raw ? String(raw).slice(0, 180) : "Chat returned empty");
          }
          return { r: r, d: d };
        });
      })
      .then(function (pack) {
        var d = pack.d || {};
        if (!pack.r.ok || d.ok === false) {
          throw new Error(d.error || "Chat failed");
        }
        var reply = String(d.text || d.reply || "").trim();
        if (!reply) throw new Error("Empty reply");
        state.messages.push({ role: "assistant", content: reply });
        save();
        render();
        emitChat("assistant", reply);
        setStatus("");
      })
      .catch(function (err) {
        if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
        setStatus((err && err.message) || "Chat failed — is start_server.bat running?", "err");
        render();
      })
      .then(function () {
        state.busy = false;
        if (btn) btn.disabled = false;
        if (input) input.focus();
      });
    return true;
  }

  function bind() {
    if (!$("panel-chat")) return;
    load();
    render();
    var form = $("ch-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        send();
      });
    }
    var input = $("ch-input");
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
    }
    $("ch-new") &&
      $("ch-new").addEventListener("click", function () {
        state.messages = [];
        save();
        render();
        setStatus("");
        if (input) input.focus();
      });
  }

  function onShow() {
    document.body.classList.add("ch-tab-active");
    var input = $("ch-input");
    if (input) setTimeout(function () {
      input.focus();
    }, 40);
    var log = $("ch-log");
    if (log) log.scrollTop = log.scrollHeight;
  }

  function onHide() {
    document.body.classList.remove("ch-tab-active");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.addEventListener("chat-show", onShow);
  window.addEventListener("chat-hide", onHide);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "chat") onShow();
    else onHide();
  });

  window.StudioChat = {
    onShow: onShow,
    onHide: onHide,
    ingest: ingest,
    sendText: sendText,
    getMessages: function () {
      return state.messages.slice();
    },
  };
})();
