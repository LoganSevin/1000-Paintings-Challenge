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

  function bind() {
    var ul = document.getElementById("vd-units");
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
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
