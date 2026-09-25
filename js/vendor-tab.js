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

  var STORE = "logan7in-vendor-gauges-v1";
  var counts = [0, 0, 0, 0, 0, 0, 0, 0];
  var slot = 0;
  var timer = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function loadState() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || "null");
      if (raw && Array.isArray(raw.counts) && raw.counts.length === UNITS.length) {
        counts = raw.counts.map(function (n) {
          return Math.max(0, parseInt(n, 10) || 0);
        });
        slot = Math.max(0, parseInt(raw.slot, 10) || 0) % UNITS.length;
        return true;
      }
    } catch (e) {}
    return false;
  }

  function saveState() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ counts: counts, slot: slot, at: Date.now() }));
    } catch (e) {}
  }

  function fillPct(i) {
    return Math.min(92, 8 + counts[i] * 4);
  }

  function paintBox(i) {
    var host = $("vd-gauges");
    if (!host || !host.children[i]) return;
    var box = host.children[i];
    var fill = box.querySelector(".vd-gauge-fill");
    var num = box.querySelector(".vd-gauge-num");
    if (fill) fill.style.height = fillPct(i) + "%";
    if (num) num.textContent = String(counts[i]);
  }

  function paintGauges() {
    var host = $("vd-gauges");
    if (!host) return;
    host.innerHTML = "";
    UNITS.forEach(function (row, i) {
      var box = document.createElement("div");
      box.className = "vd-gauge";
      box.setAttribute("data-i", String(i));
      var fill = document.createElement("div");
      fill.className = "vd-gauge-fill";
      fill.style.height = fillPct(i) + "%";
      var drop = document.createElement("div");
      drop.className = "vd-drop";
      var num = document.createElement("strong");
      num.className = "vd-gauge-num";
      num.textContent = String(counts[i]);
      var label = document.createElement("span");
      label.className = "vd-gauge-label";
      label.textContent = row.unit;
      box.appendChild(fill);
      box.appendChild(drop);
      box.appendChild(num);
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
    npc.classList.remove("is-drop");
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
    counts[i] += 1;
    paintBox(i);
    saveState();
    setTimeout(function () {
      npc.classList.remove("is-drop");
    }, 450);
  }

  function tick() {
    if (
      !document.body.classList.contains("vd-tab-active") &&
      document.body.getAttribute("data-active-tab") !== "vendor"
    ) {
      return;
    }
    setNpc(slot);
    setTimeout(function () {
      dropInto(slot);
      slot = (slot + 1) % UNITS.length;
      saveState();
    }, 720);
  }

  function bind() {
    var ul = $("vd-units");
    if (!ul) return;
    loadState();
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
    setNpc(slot);
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 1600);
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "vendor") {
        loadState();
        paintGauges();
        setNpc(slot);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
