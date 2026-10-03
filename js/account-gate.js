/**
 * Google Sign-In + bring-your-own xAI key.
 * Public generations bill the visitor's xAI account, never the artist's.
 */
(function () {
  "use strict";

  var USER_KEY = "l7in_google_user_v1";
  var XAI_PREFIX = "l7in_xai_key_";
  var user = null;
  var clientId = "";
  var googleReady = false;
  var origFetch = window.fetch.bind(window);

  function isLocal() {
    var h = (location.hostname || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function loadUser() {
    try {
      user = JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
    } catch (e) {
      user = null;
    }
    return user;
  }

  function saveUser(u) {
    user = u;
    try {
      if (u) sessionStorage.setItem(USER_KEY, JSON.stringify(u));
      else sessionStorage.removeItem(USER_KEY);
    } catch (e) {}
  }

  function keyStorageId() {
    return (user && (user.sub || user.email)) || "anon";
  }

  function getVisitorXaiKey() {
    try {
      return (localStorage.getItem(XAI_PREFIX + keyStorageId()) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function setVisitorXaiKey(key) {
    try {
      if (key) localStorage.setItem(XAI_PREFIX + keyStorageId(), key.trim());
      else localStorage.removeItem(XAI_PREFIX + keyStorageId());
    } catch (e) {}
  }

  function needsVisitorKey(url) {
    var u = String(url || "");
    return (
      /\/api\/(generate-stasis-vision|blend-spells|redefine-stasis|animate-cast|transfer)/.test(u) ||
      /\/.netlify\/functions\/(generate-stasis-vision|blend-spells|redefine-stasis|transfer)/.test(u)
    );
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (!needsVisitorKey(url) || isLocal()) {
      return origFetch(input, init);
    }
    init = init ? Object.assign({}, init) : {};
    var headers = new Headers(init.headers || (input && input.headers) || undefined);
    var key = getVisitorXaiKey();
    if (key) headers.set("X-Visitor-Xai-Key", key);
    init.headers = headers;
    return origFetch(input, init);
  };

  function ensureHud() {
    var el = document.getElementById("account-gate");
    if (el) return el;
    el = document.createElement("div");
    el.id = "account-gate";
    el.className = "account-gate";
    document.body.appendChild(el);
    return el;
  }

  function render() {
    var el = ensureHud();
    var signed = !!(user && (user.email || user.name));
    var key = getVisitorXaiKey();
    var html = "";
    if (!signed) {
      html += '<div id="account-google-btn" class="account-google-btn"></div>';
      html += '<p class="account-note">Sign in with Google, then connect <strong>your</strong> xAI key. Generates on this site bill your Grok account, not Logan&apos;s.</p>';
      html += '<button type="button" class="account-btn" id="account-key-add">Connect xAI key</button>';
    } else {
      html += '<div class="account-who">';
      if (user.picture) html += '<img class="account-pic" alt="" src="' + user.picture + '" />';
      html += "<span>" + (user.name || user.email) + "</span>";
      html += '<button type="button" class="account-link" id="account-signout">Sign out</button>';
      html += "</div>";
      if (key) {
        html += '<p class="account-note is-ok">Using your xAI credits</p>';
        html += '<button type="button" class="account-link" id="account-key-edit">Change key</button>';
      } else {
        html += '<p class="account-note">Paste your xAI API key so generates bill your Grok account.</p>';
        html += '<button type="button" class="account-btn" id="account-key-add">Connect xAI key</button>';
      }
    }
    el.innerHTML = html;
    var so = document.getElementById("account-signout");
    if (so) so.onclick = signOut;
    var add = document.getElementById("account-key-add");
    var edit = document.getElementById("account-key-edit");
    if (add) add.onclick = promptKey;
    if (edit) edit.onclick = promptKey;
    if (!signed) initGoogleButton();
  }

  function promptKeyAsync() {
    return new Promise(function (resolve) {
      var cur = getVisitorXaiKey();
      var next = window.prompt(
        "Paste an xAI API key from https://console.x.ai/team/default/api-keys\nSpellforge, blend, and describe will bill that key so generating can continue.",
        ""
      );
      if (next == null) {
        resolve(!!cur);
        return;
      }
      next = String(next).trim();
      if (!next) {
        resolve(!!cur);
        return;
      }
      setVisitorXaiKey(next);
      render();
      resolve(true);
    });
  }

  function promptKey() {
    promptKeyAsync();
  }

  function signOut() {
    saveUser(null);
    googleReady = false;
    render();
  }

  function handleCredential(response) {
    var cred = response && response.credential;
    if (!cred) return;
    origFetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: cred }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        if (res.ok && res.d && res.d.user) {
          saveUser(res.d.user);
          render();
          if (!getVisitorXaiKey()) promptKey();
          return;
        }
        return origFetch("/api/pulse/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: cred }),
        }).then(function (r2) {
          return r2.json().then(function (d2) {
            if (r2.ok && d2.user) {
              saveUser(d2.user);
              render();
              if (!getVisitorXaiKey()) promptKey();
            } else {
              throw new Error((res.d && res.d.error) || (d2 && d2.error) || "Sign-in failed");
            }
          });
        });
      })
      .catch(function (err) {
        var el = ensureHud();
        var note = el.querySelector(".account-note");
        if (note) note.textContent = (err && err.message) || "Sign-in failed";
      });
  }

  function initGoogleButton() {
    if (!clientId || googleReady) return;
    if (!window.google || !google.accounts || !google.accounts.id) return;
    var host = document.getElementById("account-google-btn");
    if (!host) return;
    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    host.innerHTML = "";
    google.accounts.id.renderButton(host, {
      theme: "filled_black",
      size: "medium",
      shape: "pill",
      text: "signin_with",
      width: 220,
    });
    googleReady = true;
  }

  function loadClientId() {
    return origFetch("/api/auth/config", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .catch(function () {
        return {};
      })
      .then(function (d) {
        if (d && d.client_id) {
          clientId = d.client_id;
          return;
        }
        return origFetch("data/google-signin.json", { cache: "no-store" })
          .then(function (r) {
            return r.ok ? r.json() : {};
          })
          .then(function (j) {
            var id = j && j.client_id;
            if (id && !String(id).startsWith("YOUR_")) clientId = id;
          })
          .catch(function () {});
      })
      .then(function () {
        if (!clientId) {
          return origFetch("/api/pulse/config", { cache: "no-store" })
            .then(function (r) {
              return r.ok ? r.json() : {};
            })
            .then(function (p) {
              if (p && p.client_id) clientId = p.client_id;
            })
            .catch(function () {});
        }
      });
  }

  function loadGsi() {
    if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) return;
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = function () {
      initGoogleButton();
    };
    document.head.appendChild(s);
  }

  window.AccountGate = {
    getVisitorXaiKey: getVisitorXaiKey,
    promptKey: promptKey,
    promptKeyAsync: promptKeyAsync,
    getUser: function () {
      return user;
    },
    isLocal: isLocal,
  };

  loadUser();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      render();
      loadClientId().then(function () {
        loadGsi();
        render();
      });
    });
  } else {
    render();
    loadClientId().then(function () {
      loadGsi();
      render();
    });
  }
})();
