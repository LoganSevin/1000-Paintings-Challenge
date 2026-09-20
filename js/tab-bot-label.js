(function () {
  "use strict";

  var OWNERS = {
  "animate": "Avril",
  "api": "Mad Scientist",
  "banker": "Banker",
  "book": "Peter",
  "brew": "Brock",
  "carousel": "Runner",
  "champions": "Obsession",
  "characters": "Jacob",
  "citations": "Marcus",
  "commercial": "ImRich2030",
  "conceptualizer": "Mildred",
  "dream": "Lucid",
  "ears": "Beethoven",
  "exchange": "Tom",
  "fight": "Andromeda",
  "fleeting-idea": "Gus",
  "gab": "Babs",
  "gallery": "Vargas",
  "game": "Trey",
  "glimpse": "Crystal",
  "houma": "Martin",
  "ideal": "Sherrie",
  "income": "BrokeBot",
  "logan": "Logan",
  "maps": "Maps",
  "market": "Shopkeeper",
  "masks": "Jason",
  "match": "Henry",
  "moba": "Pricilla",
  "mobile-art-gen": "Marc",
  "movie": "Jack",
  "muralwalk": "Skin Walker",
  "objects": "Gordo",
  "places": "Liberty",
  "plasma": "Vanessa",
  "profit": "Gain is Pain",
  "prompt": "Caesar",
  "runes": "The Blue Demon",
  "spellforge": "Wizard",
  "spells": "Warlock",
  "spellshop": "Clarence",
  "stare": "Courage",
  "supermarket": "Retailer",
  "texture": "Dragon",
  "thousand": "Donald",
  "transfer": "Hermes",
  "viral": "Amber"
};

  function ensureCss() {
    if (document.getElementById("tab-bot-label-css")) return;
    var link = document.createElement("link");
    link.id = "tab-bot-label-css";
    link.rel = "stylesheet";
    link.href = "css/tab-bot-label.css?v=1";
    document.head.appendChild(link);
  }

  function ensureLabel() {
    var el = document.getElementById("tab-bot-owner-label");
    if (el) return el;
    el = document.createElement("div");
    el.id = "tab-bot-owner-label";
    el.className = "tab-bot-owner-label";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("title", "Bot assigned to this page");
    document.body.appendChild(el);
    return el;
  }

  function currentTab() {
    var fromBody = document.body && document.body.getAttribute("data-active-tab");
    if (fromBody) return fromBody;
    var hash = (location.hash || "").replace(/^#\/?/, "").split(/[/?&]/)[0];
    return hash || "gallery";
  }

  function update(tab) {
    tab = tab || currentTab();
    if (tab === "rooms") tab = "places";
    var bot = OWNERS[tab];
    var el = ensureLabel();
    if (bot) {
      el.textContent = "Bot: " + bot;
      el.classList.remove("is-unassigned");
    } else {
      el.textContent = "Bot: Unassigned";
      el.classList.add("is-unassigned");
    }
    el.hidden = false;
    el.dataset.tab = tab;
  }

  function onReady() {
    ensureCss();
    ensureLabel();
    update();
    function onTabEvt(ev) {
      var t = (ev && ev.detail && (ev.detail.tab || ev.detail.name)) || null;
      update(t || currentTab());
    }
    window.addEventListener("tab-changed", onTabEvt);
    window.addEventListener("tabchange", onTabEvt);
    try {
      new MutationObserver(function () { update(); }).observe(document.body, { attributes: true, attributeFilter: ["data-active-tab"] });
    } catch (e) {}
    window.addEventListener("hashchange", function () { update(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
})();
