(function () {
  "use strict";

  var SEEN_KEY = "galleryWelcomeSeen";
  var TAB_KEY = "galleryTabOne";
  var MAX_ONES = 800;

  function $(id) {
    return document.getElementById(id);
  }

  function isGalleryHome() {
    var h = (location.hash || "").replace(/^#/, "").split("?")[0];
    return !h || h === "gallery";
  }

  function tabId() {
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

  function onesText(n) {
    n = Math.max(0, parseInt(n, 10) || 0);
    var paint = Math.min(n, MAX_ONES);
    if (!paint) return "";
    return new Array(paint + 1).join("1 ").trim();
  }

  function setTicker(n) {
    n = Math.max(0, parseInt(n, 10) || 0);
    var el = $("gallery-checkins");
    if (!el) return;
    var text = onesText(n);
    el.textContent = text;
    var dup = $("gallery-checkins-dup");
    if (dup) dup.textContent = text;
    el.setAttribute("aria-label", n === 1 ? "1 tab" : n + " tabs");
    var ticker = el.closest(".gallery-checkin-ticker");
    if (ticker) ticker.classList.toggle("is-marquee", n > 28);
  }

  function fetchCount() {
    return fetch("/api/gallery-checkin", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && d.count != null) setTicker(d.count);
      })
      .catch(function () {});
  }

  function registerTab() {
    fetch("/api/gallery-checkin", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: tabId() }),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && d.count != null) setTicker(d.count);
      })
      .catch(function () {
        fetchCount();
      });
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
    var inline = $("gallery-checkins-inline");
    if (inline) {
      var stat = inline.closest(".gallery-sales-stat");
      if (stat) stat.hidden = true;
    }
    fetchCount();
    registerTab();
    showWelcome();
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
      if (isGalleryHome()) showWelcome();
    });
    window.addEventListener("tab-changed", function (e) {
      var tab = e && e.detail && e.detail.tab;
      if (!tab || tab === "gallery") showWelcome();
    });
    setInterval(fetchCount, 12000);

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
