/** Load Google fonts only on desktop (phones use system fonts for speed). */
(function () {
  "use strict";
  try {
    var phone =
      window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    var coarse =
      window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (phone || (coarse && window.innerWidth < 900)) return;
    if (document.getElementById("gallery-google-fonts")) return;
    var link = document.createElement("link");
    link.id = "gallery-google-fonts";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  } catch (e) {}
})();
