(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function when(ts) {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch (e) {
      return "";
    }
  }

  function paint() {
    var snap = window.StudioTelemetry && window.StudioTelemetry.snapshot
      ? window.StudioTelemetry.snapshot()
      : null;
    if (!snap) return;
    var set = function (id, v) {
      var el = $(id);
      if (el) el.textContent = String(v);
    };
    set("tm-activity", snap.activity);
    set("tm-cloud-try", snap.cloud_try);
    set("tm-cloud-ok", snap.cloud_ok);
    set("tm-cloud-fail", snap.cloud_fail);
    set("tm-fuse", snap.fuse);
    set("tm-describe", snap.describe);
    set("tm-blend", snap.blend);
    set("tm-tabs", snap.tab_hits);
    var log = $("tm-log");
    if (log) {
      log.innerHTML = "";
      (snap.events || []).slice(0, 24).forEach(function (ev) {
        var li = document.createElement("li");
        li.textContent = when(ev.t) + " · " + ev.kind + (ev.extra ? " · " + ev.extra : "");
        log.appendChild(li);
      });
      if (!snap.events.length) {
        var empty = document.createElement("li");
        empty.textContent = "No studio events yet. Switch tabs or Generate and this log fills in.";
        log.appendChild(empty);
      }
    }
  }

  function bind() {
    if (!$("panel-telemetry")) return;
    paint();
    window.addEventListener("studio-telemetry-updated", paint);
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "telemetry") paint();
    });
    window.addEventListener("telemetry-show", paint);
  }

  window.TelemetryTab = { onShow: paint };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
