(function () {
  "use strict";

  var SEEN_KEY = "galleryWelcomeSeen";
  var LOCAL_COUNT = "galleryCheckinsLocal";

  function $(id) {
    return document.getElementById(id);
  }

  function isGalleryHome() {
    var h = (location.hash || "").replace(/^#/, "").split("?")[0];
    return !h || h === "gallery";
  }

  function setTicker(n) {
    var els = document.querySelectorAll("#gallery-checkins, .gallery-checkin-count");
    els.forEach(function (el) {
      el.textContent = String(n);
    });
  }

  function readLocal() {
    try {
      return parseInt(localStorage.getItem(LOCAL_COUNT) || "0", 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function writeLocal(n) {
    try {
      localStorage.setItem(LOCAL_COUNT, String(n));
    } catch (e) {}
  }

  function fetchCount() {
    return fetch("/api/gallery-checkin", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && d.count != null) {
          setTicker(d.count);
          return d.count;
        }
        setTicker(readLocal());
        return readLocal();
      })
      .catch(function () {
        setTicker(readLocal());
        return readLocal();
      });
  }

  function bumpCheckin() {
    var n = readLocal() + 1;
    writeLocal(n);
    setTicker(n);
    fetch("/api/gallery-checkin", { method: "POST", cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && d.count != null) setTicker(d.count);
      })
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
      if (sessionStorage.getItem(SEEN_KEY) === "1") return;
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch (e) {}
    bumpCheckin();
  }

  function captureShot() {
    var ann = window.GalleryAnnotations && window.GalleryAnnotations.snapshot
      ? window.GalleryAnnotations.snapshot()
      : "";
    return Promise.resolve(ann);
  }

  function sendFeature() {
    var name = ($("gf-name") && $("gf-name").value || "").trim();
    var email = ($("gf-email") && $("gf-email").value || "").trim();
    var note = ($("gf-note") && $("gf-note").value || "").trim();
    var status = $("gf-status");
    if (!name) {
      if (status) status.textContent = "Please leave a name.";
      $("gf-name") && $("gf-name").focus();
      return;
    }
    if (status) status.textContent = "Sending to Pulse…";
    captureShot().then(function (shot) {
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
    }).catch(function (err) {
      if (status) status.textContent = err.message || "Could not reach Pulse. Keep the studio server running, or try again on logan7in.art after this deploy.";
    });
  }

  function bind() {
    fetchCount();
    showWelcome();
    var overlay = $("gallery-welcome");
    if (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay || (e.target && e.target.closest && e.target.closest("[data-welcome-dismiss]"))) {
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
