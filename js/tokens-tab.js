(function () {
  "use strict";

  function paint() {
    var snap =
      window.StudioTelemetry && window.StudioTelemetry.snapshot
        ? window.StudioTelemetry.snapshot()
        : null;
    var el = document.getElementById("tk-insight");
    if (!el) return;
    if (!snap) {
      el.textContent = "Studio meter warming up…";
      return;
    }
    el.innerHTML =
      "<p class=\"tk-stat\">" +
      snap.activity +
      "</p>" +
      "<p>Studio actions in this browser. Cloud tries " +
      snap.cloud_try +
      " · blends " +
      snap.blend +
      " · describes " +
      snap.describe +
      " · on-device fuses " +
      snap.fuse +
      " (fuses spend no tokens).</p>";
  }

  function bind() {
    if (!document.getElementById("panel-tokens")) return;
    paint();
    window.addEventListener("studio-telemetry-updated", paint);
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "tokens") paint();
    });
  }

  window.TokensTab = { onShow: paint };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
