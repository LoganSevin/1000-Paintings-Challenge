/**
 * Claude + ChatGPT studio chats. Public site uses a visitor key only
 * (Logan7in unlimited — these vendors are not billed to the studio).
 */
(function () {
  "use strict";

  var SYSTEM =
    "You are in Logan Sevin’s 1000 Paintings Challenge studio (logan7in.art). " +
    "Help with the gallery, Spellforge, Demand briefs, and what to build next. " +
    "Art authorship stays with Logan Sevin. Do not claim you can see the user’s screen. " +
    "Keep answers tight unless asked for detail.";

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function mask(key) {
    var k = String(key || "");
    if (k.length < 10) return k ? "••••" : "";
    return k.slice(0, 4) + "…" + k.slice(-4);
  }

  function makeDesk(cfg) {
    var state = { messages: [], busy: false };

    function load() {
      try {
        var raw = JSON.parse(localStorage.getItem(cfg.storage) || "null");
        if (raw && Array.isArray(raw.messages)) state.messages = raw.messages.slice(-40);
      } catch (e) {
        state.messages = [];
      }
    }

    function save() {
      try {
        localStorage.setItem(cfg.storage, JSON.stringify({ messages: state.messages.slice(-40) }));
      } catch (e) {}
    }

    function getKey() {
      try {
        return (localStorage.getItem(cfg.keyStore) || "").trim();
      } catch (e) {
        return "";
      }
    }

    function setKey(key) {
      try {
        if (key) localStorage.setItem(cfg.keyStore, String(key).trim());
        else localStorage.removeItem(cfg.keyStore);
      } catch (e) {}
      paintKey();
    }

    function paintKey() {
      var el = $(cfg.ids.keyState);
      if (!el) return;
      var k = getKey();
      el.textContent = k ? "Key saved (" + mask(k) + "). This browser only." : "No " + cfg.vendor + " key in this browser.";
    }

    function setStatus(msg, kind) {
      var el = $(cfg.ids.status);
      if (!el) return;
      el.textContent = msg || "";
      el.className = cfg.ids.statusPrefix + (kind === "err" ? " err" : "");
    }

    function render() {
      var log = $(cfg.ids.log);
      if (!log) return;
      if (!state.messages.length) {
        log.innerHTML = '<p class="' + cfg.emptyClass + '">' + cfg.empty + "</p>";
        return;
      }
      log.innerHTML = state.messages
        .map(function (m) {
          var role = m.role === "user" ? "user" : "assistant";
          return '<div class="' + cfg.msgClass + " " + role + '">' + escapeHtml(m.content) + "</div>";
        })
        .join("");
      log.scrollTop = log.scrollHeight;
    }

    function send() {
      var input = $(cfg.ids.input);
      if (!input) return;
      var text = String(input.value || "").trim();
      if (!text) return;
      input.value = "";
      sendText(text);
    }

    function sendText(text) {
      text = String(text || "").trim();
      if (!text || state.busy) return false;
      var btn = $(cfg.ids.send);
      var input = $(cfg.ids.input);
      state.messages.push({ role: "user", content: text.slice(0, 4000) });
      save();
      render();
      state.busy = true;
      if (btn) btn.disabled = true;
      setStatus("Thinking…");
      var pending = document.createElement("div");
      pending.className = cfg.msgClass + " assistant pending";
      pending.textContent = "…";
      var log = $(cfg.ids.log);
      if (log) {
        log.appendChild(pending);
        log.scrollTop = log.scrollHeight;
      }
      var headers = { "Content-Type": "application/json" };
      var key = getKey();
      if (key) headers[cfg.header] = key;
      fetch(apiUrl(cfg.path), {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          messages: state.messages.slice(-20),
          system: SYSTEM,
        }),
      })
        .then(function (r) {
          return r.text().then(function (raw) {
            var d = {};
            try {
              d = raw ? JSON.parse(raw) : {};
            } catch (e) {
              throw new Error(raw ? String(raw).slice(0, 180) : cfg.vendor + " returned empty");
            }
            return { r: r, d: d };
          });
        })
        .then(function (pack) {
          var d = pack.d || {};
          if (!pack.r.ok || d.ok === false) {
            throw new Error(d.error || cfg.vendor + " failed");
          }
          var reply = String(d.text || d.reply || "").trim();
          if (!reply) throw new Error("Empty reply");
          state.messages.push({ role: "assistant", content: reply });
          save();
          render();
          setStatus(d.model ? d.model : "");
        })
        .catch(function (err) {
          if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
          setStatus((err && err.message) || cfg.vendor + " failed", "err");
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
      if (!$(cfg.ids.panel)) return;
      load();
      render();
      paintKey();
      var form = $(cfg.ids.form);
      if (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          send();
        });
      }
      var input = $(cfg.ids.input);
      if (input) {
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        });
      }
      var neu = $(cfg.ids.fresh);
      if (neu) {
        neu.addEventListener("click", function () {
          state.messages = [];
          save();
          render();
          setStatus("");
          if (input) input.focus();
        });
      }
      var connect = $(cfg.ids.connect);
      if (connect) {
        connect.addEventListener("click", function () {
          var next = window.prompt("Paste your " + cfg.vendor + " API key (stays in this browser):", getKey() || "");
          if (next == null) return;
          setKey(String(next).trim());
        });
      }
      var forget = $(cfg.ids.forget);
      if (forget) {
        forget.addEventListener("click", function () {
          setKey("");
        });
      }
    }

    function onShow() {
      document.body.classList.add(cfg.bodyClass);
      paintKey();
      var input = $(cfg.ids.input);
      if (input) {
        setTimeout(function () {
          input.focus();
        }, 40);
      }
      var log = $(cfg.ids.log);
      if (log) log.scrollTop = log.scrollHeight;
    }

    function onHide() {
      document.body.classList.remove(cfg.bodyClass);
    }

    return {
      bind: bind,
      onShow: onShow,
      onHide: onHide,
      sendText: sendText,
    };
  }

  var claude = makeDesk({
    vendor: "Claude",
    storage: "gallery.claude-chat.v1",
    keyStore: "l7in_anthropic_key_v1",
    path: "/api/claude-chat",
    header: "X-Visitor-Anthropic-Key",
    bodyClass: "cl-tab-active",
    emptyClass: "cl-empty",
    msgClass: "cl-msg",
    empty: "Claude in the studio. Paste an Anthropic key to talk — Logan7in unlimited does not bill Claude to the gallery.",
    ids: {
      panel: "panel-claude",
      log: "cl-log",
      form: "cl-form",
      input: "cl-input",
      send: "cl-send",
      fresh: "cl-new",
      status: "cl-status",
      statusPrefix: "cl-status",
      keyState: "cl-key-state",
      connect: "cl-connect",
      forget: "cl-forget",
    },
  });

  var chatgpt = makeDesk({
    vendor: "ChatGPT",
    storage: "gallery.chatgpt-chat.v1",
    keyStore: "l7in_openai_key_v1",
    path: "/api/openai-chat",
    header: "X-Visitor-OpenAI-Key",
    bodyClass: "cg-tab-active",
    emptyClass: "cg-empty",
    msgClass: "cg-msg",
    empty: "ChatGPT in the studio. Paste an OpenAI key to talk — Logan7in unlimited does not bill OpenAI to the gallery.",
    ids: {
      panel: "panel-chatgpt",
      log: "cg-log",
      form: "cg-form",
      input: "cg-input",
      send: "cg-send",
      fresh: "cg-new",
      status: "cg-status",
      statusPrefix: "cg-status",
      keyState: "cg-key-state",
      connect: "cg-connect",
      forget: "cg-forget",
    },
  });

  function bind() {
    claude.bind();
    chatgpt.bind();
  }

  window.addEventListener("claude-show", claude.onShow);
  window.addEventListener("claude-hide", claude.onHide);
  window.addEventListener("chatgpt-show", chatgpt.onShow);
  window.addEventListener("chatgpt-hide", chatgpt.onHide);
  window.addEventListener("tab-changed", function (e) {
    var tab = e.detail && e.detail.tab;
    if (tab === "claude") claude.onShow();
    else claude.onHide();
    if (tab === "chatgpt") chatgpt.onShow();
    else chatgpt.onHide();
  });

  window.ClaudeChat = claude;
  window.ChatGptChat = chatgpt;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
