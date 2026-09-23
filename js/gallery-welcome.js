(function () {
  "use strict";

  var SEEN_KEY = "galleryWelcomeSeen";
  var TAB_KEY = "galleryTabOne";
  var TAB_RE = /^[a-z0-9-]{1,40}$/;
  var counts = {};
  var currentTab = "gallery";

  function $(id) {
    return document.getElementById(id);
  }

  function isGalleryHome() {
    var h = (location.hash || "").replace(/^#/, "").split("?")[0];
    return !h || h === "gallery";
  }

  function hashTab() {
    var h = (location.hash || "").replace(/^#/, "").split("?")[0];
    if (!h || h === "subscribe") return "gallery";
    if (h === "0-z" || h === "zeroz" || h === "0z") return "az";
    if (h === "kjv" || h === "scripture") return "bible";
    if (h === "rooms") return "places";
    return h;
  }

  function sessionId() {
    try {
      var id = sessionStorage.getItem(TAB_KEY);
      if (id && id.length >= 8) return id;
      id =
        (crypto.randomUUID && crypto.randomUUID()) ||
        "tab-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(TAB_KEY, id);
      return id;
    } catch (e) {
      return "tab-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function tabButtons() {
    return document.querySelectorAll(
      ".site-tabs .tab[data-tab], .kids-tabs .tab[data-tab], .site-tabs-more-item[data-tab]"
    );
  }

  function ensureTally(btn) {
    var tally = btn.querySelector(":scope > .tab-tally");
    if (tally) return tally;
    var name = btn.querySelector(":scope > .tab-name");
    if (!name) {
      name = document.createElement("span");
      name.className = "tab-name";
      while (btn.firstChild) name.appendChild(btn.firstChild);
      btn.appendChild(name);
    }
    tally = document.createElement("span");
    tally.className = "tab-tally";
    tally.setAttribute("aria-hidden", "true");
    btn.insertBefore(tally, btn.firstChild);
    return tally;
  }

  function rowOf(name) {
    var row = counts[name];
    if (row && typeof row === "object") {
      return {
        opens: parseInt(row.opens, 10) || 0,
        live: parseInt(row.live, 10) || 0,
      };
    }
    if (typeof row === "number") return { opens: row, live: 0 };
    return { opens: 0, live: 0 };
  }

  function paintTab(name, row) {
    row = row || rowOf(name);
    document.querySelectorAll('[data-tab="' + cssEscape(name) + '"]').forEach(function (btn) {
      if (!btn.closest(".site-tabs, .kids-tabs, .site-tabs-more")) return;
      var tally = ensureTally(btn);
      tally.textContent = row.opens + ":" + row.live;
      tally.classList.toggle("is-live", row.live > 0);
      btn.title = row.opens + " opens : " + row.live + " here now";
    });
  }

  function paintAll(next) {
    counts = next && typeof next === "object" ? next : {};
    tabButtons().forEach(function (btn) {
      var name = btn.getAttribute("data-tab");
      paintTab(name, rowOf(name));
    });
  }

  function applyPayload(d) {
    if (d && d.counts) paintAll(d.counts);
  }

  var lastBumpTab = "";
  var lastBumpAt = 0;
  var BUMP_DEBOUNCE_MS = 1500;

  function postTab(name, bump) {
    name = String(name || "").toLowerCase();
    if (!TAB_RE.test(name)) return;
    if (bump) {
      var now = Date.now();
      // Collapse click + hashchange (and any rapid re-entry) into one open.
      if (name === lastBumpTab && now - lastBumpAt < BUMP_DEBOUNCE_MS) {
        bump = false;
      } else {
        lastBumpTab = name;
        lastBumpAt = now;
      }
    }
    currentTab = name;
    if (bump) {
      var row = rowOf(name);
      row.opens += 1;
      row.live = Math.max(1, row.live);
      counts[name] = row;
      paintTab(name, row);
    }
    fetch("/api/gallery-checkin", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tab: name,
        id: sessionId(),
        bump: bump ? true : false,
      }),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(applyPayload)
      .catch(function () {});
  }

  function fetchCounts() {
    return fetch("/api/gallery-checkin", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(applyPayload)
      .catch(function () {});
  }

  function showWelcome() {
    if (!isGalleryHome()) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY) === "1") return;
    } catch (e) {}
    var overlay = $("gallery-welcome");
    if (!overlay) return;
    overlay.hidden = false;
  }

  function dismissWelcome() {
    var overlay = $("gallery-welcome");
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch (e) {}
  }

  function captureShot() {
    var ann =
      window.GalleryAnnotations && window.GalleryAnnotations.snapshot
        ? window.GalleryAnnotations.snapshot()
        : "";
    return Promise.resolve(ann);
  }

  function sendFeature() {
    var name = (($("gf-name") && $("gf-name").value) || "").trim();
    var email = (($("gf-email") && $("gf-email").value) || "").trim();
    var note = (($("gf-note") && $("gf-note").value) || "").trim();
    var status = $("gf-status");
    if (!name) {
      if (status) status.textContent = "Please leave a name.";
      $("gf-name") && $("gf-name").focus();
      return;
    }
    if (status) status.textContent = "Sending to Pulse…";
    captureShot()
      .then(function (shot) {
        var text =
          "Feature request from " +
          name +
          (email ? " (" + email + ")" : "") +
          "\nPage: " +
          location.href +
          (note ? "\n\n" + note : "\n\n(See attached page annotation.)");
        return fetch("/api/pulse/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: name,
            text: text,
            image_base64: shot || undefined,
            kind: "feature",
          }),
        }).then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || d.ok === false) throw new Error(d.error || "Could not post");
            if (status) status.textContent = "Sent to Pulse. Thank you, " + name + ".";
            if ($("gf-note")) $("gf-note").value = "";
            if (window.GalleryAnnotations) window.GalleryAnnotations.disarm();
            setTimeout(function () {
              var sheet = $("gallery-feature");
              if (sheet) sheet.hidden = true;
              if (status) status.textContent = "";
            }, 1600);
          });
        });
      })
      .catch(function (err) {
        if (status) {
          status.textContent =
            err.message ||
            "Could not reach Pulse. Keep the studio server running, or try again on logan7in.art after this deploy.";
        }
      });
  }

  function bind() {
    var ticker = document.querySelector(".gallery-checkin-ticker");
    if (ticker) ticker.remove();
    var inline = $("gallery-checkins-inline");
    if (inline) {
      var stat = inline.closest(".gallery-sales-stat");
      if (stat) stat.hidden = true;
    }
    tabButtons().forEach(ensureTally);
    fetchCounts();
    postTab(hashTab(), true);
    showWelcome();
    document.addEventListener(
      "click",
      function (e) {
        var btn =
          e.target &&
          e.target.closest &&
          e.target.closest(
            ".site-tabs .tab[data-tab], .kids-tabs .tab[data-tab], .site-tabs-more-item[data-tab]"
          );
        if (!btn) return;
        var name = btn.getAttribute("data-tab");
        if (!name) return;
        postTab(name, true);
      },
      true
    );
    var overlay = $("gallery-welcome");
    if (overlay) {
      overlay.addEventListener("click", function (e) {
        if (
          e.target === overlay ||
          (e.target && e.target.closest && e.target.closest("[data-welcome-dismiss]"))
        ) {
          dismissWelcome();
        }
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") dismissWelcome();
    });
    window.addEventListener("hashchange", function () {
      var name = hashTab();
      // Click path already bumped via capture listener and set currentTab.
      // Only count hash-only navigations (back/forward, deep links).
      if (name !== currentTab) postTab(name, true);
      else postTab(name, false);
      if (isGalleryHome()) showWelcome();
    });
    window.addEventListener("tab-changed", function (e) {
      var tab = e && e.detail && e.detail.tab;
      if (!tab || tab === "gallery") showWelcome();
    });
    setInterval(fetchCounts, 3000);
    setInterval(function () {
      postTab(currentTab, false);
    }, 5000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") return;
      fetchCounts();
      postTab(currentTab, false);
    });

    var mega = $("gallery-megaphone");
    var sheet = $("gallery-feature");
    if (mega) {
      mega.addEventListener("click", function () {
        if (sheet) sheet.hidden = false;
        if (window.GalleryAnnotations) window.GalleryAnnotations.arm();
        $("gf-name") && $("gf-name").focus();
      });
    }
    var cancel = $("gf-cancel");
    if (cancel) {
      cancel.addEventListener("click", function () {
        if (sheet) sheet.hidden = true;
        if (window.GalleryAnnotations) window.GalleryAnnotations.disarm();
      });
    }
    var send = $("gf-send");
    if (send) send.addEventListener("click", sendFeature);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
