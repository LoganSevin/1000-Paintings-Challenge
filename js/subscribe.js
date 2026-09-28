/**
 * Subscribe tab — Studio Dispatch signup (same list as subscribe.html).
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function mailtoFallback(email) {
    location.href =
      "mailto:lsevin71@gmail.com?subject=" +
      encodeURIComponent("Subscribe Studio Dispatch") +
      "&body=" +
      encodeURIComponent(email);
  }

  function bind() {
    var form = $("nl-form");
    var status = $("nl-status");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var emailEl = $("nl-email");
      var email = emailEl ? String(emailEl.value || "").trim() : "";
      if (!email) return;
      if (status) {
        status.className = "nl-status";
        status.textContent = "Joining…";
      }
      var body = JSON.stringify({ email: email, source: "subscribe-tab", tier: "free" });
      fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok && d && d.ok, d: d };
          });
        })
        .then(function (res) {
          if (res.ok) {
            if (status) status.textContent = "You’re on the free list.";
            form.reset();
            return;
          }
          return fetch("/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ "form-name": "studio-dispatch", email: email }).toString(),
          }).then(function (r) {
            if (r.ok) {
              if (status) status.textContent = "You’re on the list.";
              form.reset();
            } else {
              if (status) {
                status.className = "nl-status err";
                status.textContent = "Could not reach the list — opening mail…";
              }
              mailtoFallback(email);
            }
          });
        })
        .catch(function () {
          if (status) {
            status.className = "nl-status err";
            status.textContent = "Opening mail to finish signup…";
          }
          mailtoFallback(email);
        });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
