(function () {
  "use strict";

  var UNITS = [
    { unit: "Token", note: "Chunk of text Grok reads or writes. Blend, redefine, and describe spend these." },
    { unit: "Image gen", note: "One cloud still. Spellforge Generate when a key can spend." },
    { unit: "Prepaid $", note: "xAI wallet balance on a key. Vendor dollars, not a studio budget." },
    { unit: "Week spend $", note: "Soft weekly burn on that key. Telemetry on the Vendor meter needle." },
    { unit: "API key", note: "Who xAI charges. Site key, visitor key, or no key (free path)." },
    { unit: "Management key", note: "Read-only key for prepaid readout. Optional. Studio meter works without it." },
    { unit: "Request", note: "One HTTP call to api.x.ai. Counted by the vendor, not by Logan7in unlimited." },
    { unit: "Team", note: "xAI billing account UUID. Their org, not this gallery’s door." },
  ];

  var fills = [18, 22, 16, 20, 14, 12, 24, 10];
  var slot = 0;
  var timer = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function fillFromStudio(i) {
    var snap =
      window.StudioTelemetry && window.StudioTelemetry.snapshot
        ? window.StudioTelemetry.snapshot()
        : null;
    if (!snap) return fills[i];
    var map = [
      Math.min(100, 12 + snap.describe * 8 + snap.blend * 8),
      Math.min(100, 10 + snap.cloud_try * 12),
      Math.min(100, 8 + snap.activity * 3),
      Math.min(100, 8 + snap.cloud_fail * 10 + snap.cloud_try * 4),
      snap.cloud_try || snap.describe ? 55 : 18,
      20,
      Math.min(100, 10 + (snap.cloud_try + snap.blend + snap.describe) * 8),
      Math.min(100, 15 + snap.tab_hits * 2),
    ];
    return map[i];
  }

  function paintGauges() {
    var host = $("vd-gauges");
    if (!host || host.children.length) return;
    UNITS.forEach(function (row, i) {
      var box = document.createElement("div");
      box.className = "vd-gauge";
      box.setAttribute("data-i", String(i));
      var fill = document.createElement("div");
      fill.className = "vd-gauge-fill";
      fill.style.height = fills[i] + "%";
      var drop = document.createElement("div");
      drop.className = "vd-drop";
      var label = document.createElement("span");
      label.className = "vd-gauge-label";
      label.textContent = row.unit;
      box.appendChild(fill);
      box.appendChild(drop);
      box.appendChild(label);
      host.appendChild(box);
    });
  }

  function setNpc(i) {
    var npc = $("vd-npc");
    var host = $("vd-gauges");
    if (!npc || !host || !host.children[i]) return;
    var cell = host.children[i];
    var left = host.offsetLeft + cell.offsetLeft + cell.offsetWidth / 2 - npc.offsetWidth / 2;
    npc.style.left = Math.max(0, left) + "px";
    npc.classList.add("is-walk");
  }

  function dropInto(i) {
    var host = $("vd-gauges");
    var npc = $("vd-npc");
    if (!host || !host.children[i]) return;
    var box = host.children[i];
    npc.classList.remove("is-walk");
    npc.classList.add("is-drop");
    box.classList.remove("is-drop");
    void box.offsetWidth;
    box.classList.add("is-drop");
    fills[i] = Math.min(92, Math.max(fillFromStudio(i), fills[i] + 7));
    var fill = box.querySelector(".vd-gauge-fill");
    if (fill) fill.style.height = fills[i] + "%";
    setTimeout(function () {
      npc.classList.remove("is-drop");
    }, 450);
  }

  function tick() {
    if (!document.body.classList.contains("vd-tab-active") && document.body.getAttribute("data-active-tab") !== "vendor") {
      return;
    }
    setNpc(slot);
    setTimeout(function () {
      dropInto(slot);
      slot = (slot + 1) % UNITS.length;
    }, 720);
  }

  function bind() {
    var ul = $("vd-units");
    if (!ul) return;
    ul.innerHTML = "";
    UNITS.forEach(function (row) {
      var li = document.createElement("li");
      var u = document.createElement("span");
      u.className = "vd-unit";
      u.textContent = row.unit;
      var n = document.createElement("span");
      n.className = "vd-note";
      n.textContent = row.note;
      li.appendChild(u);
      li.appendChild(n);
      ul.appendChild(li);
    });
    paintGauges();
    UNITS.forEach(function (_, i) {
      fills[i] = fillFromStudio(i);
      var box = $("vd-gauges") && $("vd-gauges").children[i];
      if (box) {
        var fill = box.querySelector(".vd-gauge-fill");
        if (fill) fill.style.height = fills[i] + "%";
      }
    });
    setNpc(0);
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 1600);
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "vendor") {
        setNpc(slot);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
