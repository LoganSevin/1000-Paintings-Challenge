(function () {
  "use strict";

  var ACTIONS = [
    { group: "Make", name: "Generate a vision", note: "Spellforge — cloud if a key can spend, else on-device fuse", href: "#spellforge" },
    { group: "Make", name: "Build a spell chain", note: "Pipeline of paintings, no xAI bill", href: "#chains" },
    { group: "Make", name: "Animate a clip", note: "Cast spells into motion", href: "#animate" },
    { group: "Make", name: "Write a prompt from pictures", note: "Drop images, copy the prompt", href: "#prompt" },
    { group: "Make", name: "Upload from phone", note: "Photos land in Phone / Assets", href: "#transfer" },
    { group: "Look", name: "Browse the gallery", note: "Paintings, donations not sale prices", href: "#gallery" },
    { group: "Look", name: "Open the asset shelf", note: "Idea pictures, phone, objects, maps, paintings", href: "#assets" },
    { group: "Look", name: "Walk the mural", note: "Paintings as floor", href: "#muralwalk" },
    { group: "Look", name: "Fleeting Idea", note: "Overhead projector, layers", href: "#fleeting-idea" },
    { group: "Look", name: "Kids Mode", note: "Last tab; exit code 4200", href: "#kids" },
    { group: "Language", name: "API How it works", note: "Highlight, Define, Suggest for fix", href: "#api" },
    { group: "Language", name: "Define invoice", note: "Bill in the vendor meter", href: "#api" },
    { group: "Meter", name: "xAI vendor meter", note: "Maintainer keeps the gauge; studio uncapped", href: "#xai" },
    { group: "Meter", name: "Cloud xAI", note: "Vendor view, not the studio", href: "#cloud-xai" },
    { group: "Meter", name: "Telemetry", note: "Cloud tries, fuses, describes, tab hits", href: "#telemetry" },
    { group: "Share", name: "Pulse", note: "Feed, feature requests", href: "#pulse" },
    { group: "Share", name: "Get paid", note: "Donations, print shops", href: "#income" },
  ];

  function bind() {
    var listRoot = document.getElementById("su-groups");
    var search = document.getElementById("su-search");
    if (!listRoot) return;

    function paint(q) {
      q = String(q || "").toLowerCase().trim();
      listRoot.innerHTML = "";
      var groups = [];
      ACTIONS.forEach(function (act) {
        if (
          q &&
          (act.name + " " + act.note + " " + act.group).toLowerCase().indexOf(q) < 0
        ) {
          return;
        }
        if (groups.indexOf(act.group) < 0) groups.push(act.group);
      });
      groups.forEach(function (g) {
        var wrap = document.createElement("div");
        wrap.className = "su-group";
        var h = document.createElement("h3");
        h.textContent = g;
        var ul = document.createElement("ul");
        ul.className = "su-list";
        ACTIONS.forEach(function (act) {
          if (act.group !== g) return;
          if (q && (act.name + " " + act.note + " " + act.group).toLowerCase().indexOf(q) < 0) return;
          var li = document.createElement("li");
          var a = document.createElement("a");
          a.href = act.href;
          var name = document.createElement("span");
          name.className = "su-act";
          name.textContent = act.name;
          var note = document.createElement("span");
          note.className = "su-note";
          note.textContent = act.note;
          a.appendChild(name);
          a.appendChild(note);
          li.appendChild(a);
          ul.appendChild(li);
        });
        wrap.appendChild(h);
        wrap.appendChild(ul);
        listRoot.appendChild(wrap);
      });
    }

    paint("");
    if (search) {
      search.addEventListener("input", function () {
        paint(search.value);
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
