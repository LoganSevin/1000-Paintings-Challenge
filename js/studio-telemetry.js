(function () {
  "use strict";

  var KEY = "logan7in-studio-telemetry-v1";
  var MAX_EVENTS = 48;

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (!raw || typeof raw !== "object") raw = {};
      return {
        cloud_try: Number(raw.cloud_try) || 0,
        cloud_ok: Number(raw.cloud_ok) || 0,
        cloud_fail: Number(raw.cloud_fail) || 0,
        fuse: Number(raw.fuse) || 0,
        describe: Number(raw.describe) || 0,
        blend: Number(raw.blend) || 0,
        tabs: raw.tabs && typeof raw.tabs === "object" ? raw.tabs : {},
        events: Array.isArray(raw.events) ? raw.events : [],
      };
    } catch (e) {
      return {
        cloud_try: 0,
        cloud_ok: 0,
        cloud_fail: 0,
        fuse: 0,
        describe: 0,
        blend: 0,
        tabs: {},
        events: [],
      };
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("studio-telemetry-updated", { detail: snapshot() }));
    } catch (e2) {}
  }

  function note(kind, extra) {
    var data = load();
    if (kind === "cloud_try") data.cloud_try++;
    else if (kind === "cloud_ok") data.cloud_ok++;
    else if (kind === "cloud_fail") data.cloud_fail++;
    else if (kind === "fuse") data.fuse++;
    else if (kind === "describe") data.describe++;
    else if (kind === "blend") data.blend++;
    else if (kind === "tab") {
      var t = String(extra || "gallery");
      data.tabs[t] = (Number(data.tabs[t]) || 0) + 1;
    }
    data.events.unshift({ t: Date.now(), kind: kind, extra: extra || "" });
    data.events = data.events.slice(0, MAX_EVENTS);
    save(data);
  }

  function snapshot() {
    var data = load();
    var tabHits = 0;
    Object.keys(data.tabs).forEach(function (k) {
      tabHits += Number(data.tabs[k]) || 0;
    });
    var activity = data.cloud_try + data.fuse + data.describe + data.blend + tabHits;
    return {
      ok: true,
      studio: true,
      cloud_try: data.cloud_try,
      cloud_ok: data.cloud_ok,
      cloud_fail: data.cloud_fail,
      fuse: data.fuse,
      describe: data.describe,
      blend: data.blend,
      tab_hits: tabHits,
      tabs: data.tabs,
      events: data.events,
      activity: activity,
      needle: Math.max(0, Math.min(1, activity / 24)),
    };
  }

  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var p = origFetch(input, init);
    if (method !== "POST") return p;
    if (/generate-stasis-vision/.test(url)) {
      note("cloud_try", "generate");
      return p.then(
        function (r) {
          note(r.ok ? "cloud_ok" : "cloud_fail", "generate " + r.status);
          return r;
        },
        function (err) {
          note("cloud_fail", "generate network");
          throw err;
        }
      );
    }
    if (/blend-spells|redefine-stasis/.test(url)) {
      note("blend", url);
      return p;
    }
    if (/transfer\/(upload|describe)|transfer-upload/.test(url)) {
      note("describe", url);
      return p;
    }
    return p;
  };

  window.addEventListener("tab-changed", function (e) {
    var tab = e && e.detail && e.detail.tab;
    if (tab) note("tab", tab);
  });
  window.addEventListener("spellforge-local-fuse", function () {
    note("fuse", "on-device");
  });

  window.StudioTelemetry = {
    note: note,
    snapshot: snapshot,
    load: load,
  };
})();
