/**
 * Zoo — Linnaean taxonomy desk. Stock creature in a circular UI radius,
 * three 1/3 arc spell slots. Cast is a Spellforge description blend
 * (field photography / species discovery) — the circle is UI only.
 */
(function () {
  "use strict";

  var STORAGE = "gallery.zoo.v1";
  var GEN_BASE = 100000;
  var BOOK_PAGE = 25;
  var FETCH_MS = 45000;
  var RANKS = ["domain", "kingdom", "phylum", "class", "order", "family", "genus", "species"];
  var ROMAN = ["I", "II", "III"];
  var REALMS = [
    { name: "Animalia", key: 1, label: "Animals" },
    { name: "Plantae", key: 6, label: "Plants" },
    { name: "Fungi", key: 5, label: "Fungi" },
  ];
  var RANK_META = {
    domain: {
      label: "Domain",
      chip: "3 trunks of life",
      hint: "The three trunks of life: Bacteria, Archaea, and Eukarya",
    },
    kingdom: {
      label: "Kingdom",
      chip: "animals, plants…",
      hint: "Broad living groups — animals, plants, fungi",
    },
    phylum: {
      label: "Phylum",
      chip: "body plan",
      hint: "Major body plan — chordates, arthropods, molluscs",
    },
    class: {
      label: "Class",
      chip: "mammals, birds…",
      hint: "Big groups inside a phylum — mammals, birds, insects",
    },
    order: {
      label: "Order",
      chip: "carnivores…",
      hint: "Next split — carnivores, primates, rodents",
    },
    family: {
      label: "Family",
      chip: "cats, dogs…",
      hint: "Close clans — cats, dogs, whales",
    },
    genus: {
      label: "Genus",
      chip: "close relatives",
      hint: "Tight relatives sharing a name, e.g. Panthera (big cats)",
    },
    species: {
      label: "Species",
      chip: "the exact kind",
      hint: "The exact kind, e.g. lion — Panthera leo",
    },
  };
  var TAXON_PLAIN = {
    eukarya: "cells with nuclei",
    bacteria: "bacteria",
    archaea: "ancient microbes",
    animalia: "animals",
    plantae: "plants",
    fungi: "fungi",
    chromista: "kelp, diatoms & kin",
    protozoa: "mostly single-celled eukaryotes",
    chordata: "backboned animals & kin",
    arthropoda: "insects, spiders, crabs",
    mollusca: "snails, octopuses, clams",
    cnidaria: "jellies, corals, anemones",
    echinodermata: "starfish, urchins, sea cucumbers",
    annelida: "segmented worms",
    nematoda: "roundworms",
    platyhelminthes: "flatworms",
    porifera: "sponges",
    ctenophora: "comb jellies",
    bryozoa: "moss animals",
    brachiopoda: "lamp shells",
    acanthocephala: "thorny-headed worms",
    chaetognatha: "arrow worms",
    tardigrada: "water bears",
    onychophora: "velvet worms",
    rotifera: "wheel animals",
    nemertea: "ribbon worms",
    hemichordata: "acorn worms",
    xenacoelomorpha: "simple marine worms",
    gastrotricha: "hairy-backed worms",
    kinorhyncha: "mud dragons",
    priapulida: "penis worms",
    sipuncula: "peanut worms",
    nematomorpha: "horsehair worms",
    loricifera: "girdle-wearers",
    placozoa: "plate animals",
    vertebrata: "vertebrates (backbones)",
    mammalia: "mammals",
    aves: "birds",
    reptilia: "reptiles",
    amphibia: "amphibians",
    actinopterygii: "ray-finned fish",
    chondrichthyes: "sharks, rays & chimaeras",
    sarcopterygii: "lobe-finned fish",
    insecta: "insects",
    arachnida: "spiders, scorpions, mites",
    malacostraca: "crabs, shrimp, lobsters",
    chilopoda: "centipedes",
    diplopoda: "millipedes",
    merostomata: "horseshoe crabs",
    xiphosura: "horseshoe crabs",
    cephalopoda: "octopuses, squid, nautilus",
    bivalvia: "clams, oysters, mussels",
    gastropoda: "snails & slugs",
    scyphozoa: "true jellyfish",
    anthozoa: "corals & anemones",
    hydrozoa: "hydroids & siphonophores",
    asteroidea: "starfish",
    echinoidea: "sea urchins",
    holothuroidea: "sea cucumbers",
    ophiuroidea: "brittle stars",
    crinoidea: "sea lilies & feather stars",
    carnivora: "carnivores (cats, dogs, bears)",
    primates: "primates (apes, monkeys, lemurs)",
    rodentia: "rodents",
    chiroptera: "bats",
    artiodactyla: "even-toed hoofed mammals & whales",
    cetacea: "whales & dolphins",
    perissodactyla: "odd-toed hoofed mammals",
    lagomorpha: "rabbits & hares",
    squamata: "lizards & snakes",
    testudines: "turtles & tortoises",
    crocodilia: "crocodiles & alligators",
    anura: "frogs & toads",
    urodela: "salamanders & newts",
    caudata: "salamanders & newts",
    gymnophiona: "caecilians",
    passeriformes: "perching birds",
    accipitriformes: "hawks & eagles",
    sphenisciformes: "penguins",
    strigiformes: "owls",
    psittaciformes: "parrots",
    galliformes: "landfowl (chickens, peafowl)",
    lepidoptera: "butterflies & moths",
    coleoptera: "beetles",
    hymenoptera: "bees, wasps, ants",
    diptera: "flies",
    araneae: "spiders",
    octopoda: "octopuses",
    lamniformes: "mackerel sharks",
    syngnathiformes: "seahorses & pipefish",
    felidae: "cats",
    canidae: "dogs, wolves, foxes",
    ursidae: "bears",
    hominidae: "great apes",
    elephantidae: "elephants",
    delphinidae: "oceanic dolphins",
    accipitridae: "hawks & eagles",
    panthera: "roaring cats",
    canis: "wolves & dogs",
    ursus: "typical bears",
  };
  var FALLBACK_DOMAINS = [
    { id: "eukarya", name: "Eukarya", note: "Animals, plants, fungi, protists — cells with nuclei" },
    { id: "bacteria", name: "Bacteria", key: 3, kingdom: "Bacteria", note: "Everyday microbes; not Eukarya" },
    { id: "archaea", name: "Archaea", key: 2, kingdom: "Archaea", note: "Ancient microbes; not Eukarya" },
  ];
  var FALLBACK_KINGDOMS = [
    { name: "Animalia", key: 1, domain: "Eukarya" },
    { name: "Plantae", key: 6, domain: "Eukarya" },
    { name: "Fungi", key: 5, domain: "Eukarya" },
    { name: "Chromista", key: 4, domain: "Eukarya" },
    { name: "Protozoa", key: 7, domain: "Eukarya" },
    { name: "Bacteria", key: 3, domain: "Bacteria" },
    { name: "Archaea", key: 2, domain: "Archaea" },
  ];

  var state = {
    ready: false,
    classes: [],
    featured: [],
    domains: FALLBACK_DOMAINS,
    kingdoms: FALLBACK_KINGDOMS,
    list: [],
    domainId: "eukarya",
    kingdomName: "Animalia",
    kingdomKey: 1,
    classId: "mammals",
    rank: "species",
    parentKey: 1,
    trail: [],
    q: "",
    selected: null,
    view: "stock",
    genUrl: "",
    slots: [null, null, null],
    bookSlot: 0,
    bookPage: 0,
    bookOrder: [],
    analyses: null,
    lod1: null,
    childCache: {},
    childWait: {},
    stockToken: 0,
    stockKey: "",
    stockLoading: "",
    stockReady: false,
    rushing: false,
    aspect: "1:1",
    casting: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function loadState() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if (!raw || typeof raw !== "object") return;
      if (Array.isArray(raw.slots)) state.slots = [raw.slots[0] || null, raw.slots[1] || null, raw.slots[2] || null];
      if (raw.classId) state.classId = raw.classId;
      if (raw.aspect) state.aspect = raw.aspect;
      if (raw.bookPage >= 0) state.bookPage = raw.bookPage | 0;
    } catch (e) {}
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({
          slots: state.slots,
          classId: state.classId,
          aspect: state.aspect,
          bookPage: state.bookPage | 0,
        })
      );
    } catch (e) {}
  }

  function setStatus(msg, kind) {
    var el = $("zoo-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "zoo-status" + (kind ? " " + kind : "");
  }

  function fetchJson(url, ms) {
    var opts = { cache: "no-store" };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      opts.signal = AbortSignal.timeout(ms || FETCH_MS);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || r.statusText || "Request failed");
        return d;
      });
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function polar(cx, cy, r, deg) {
    var a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function annularPath(cx, cy, r0, r1, a0, a1) {
    var sweep = (a1 - a0) % 360;
    if (sweep < 0) sweep += 360;
    var large = sweep > 180 ? 1 : 0;
    var p0 = polar(cx, cy, r1, a0);
    var p1 = polar(cx, cy, r1, a1);
    var p2 = polar(cx, cy, r0, a1);
    var p3 = polar(cx, cy, r0, a0);
    return (
      "M" +
      p0[0].toFixed(2) +
      "," +
      p0[1].toFixed(2) +
      " A" +
      r1 +
      "," +
      r1 +
      " 0 " +
      large +
      " 1 " +
      p1[0].toFixed(2) +
      "," +
      p1[1].toFixed(2) +
      " L" +
      p2[0].toFixed(2) +
      "," +
      p2[1].toFixed(2) +
      " A" +
      r0 +
      "," +
      r0 +
      " 0 " +
      large +
      " 0 " +
      p3[0].toFixed(2) +
      "," +
      p3[1].toFixed(2) +
      " Z"
    );
  }

  function imageUrl(row) {
    if (!row) return "";
    if (row.image_url) return apiUrl(row.image_url);
    var params = [];
    if (row.scientific) params.push("scientific=" + encodeURIComponent(row.scientific));
    if (row.common) params.push("common=" + encodeURIComponent(row.common));
    if (row.wiki) params.push("wiki=" + encodeURIComponent(row.wiki));
    if (row.key) params.push("key=" + encodeURIComponent(row.key));
    var king = row.kingdom || state.kingdomName || "Animalia";
    if (king) params.push("kingdom=" + encodeURIComponent(king));
    if (!params.length) return "";
    params.push("v=3");
    return apiUrl("/api/zoo/image?" + params.join("&"));
  }

  function spellLabel(n) {
    n = parseInt(n, 10);
    if (!n) return "—";
    if (n >= 1 && n <= 1000) return "#" + n;
    if (n >= GEN_BASE && n < 200000) return "G#" + (n - GEN_BASE);
    if (n >= 200000 && n < 300000) return "S#" + (n - 200000);
    if (n >= 300000 && n < 400000) return "SI#" + (n - 300000);
    return "#" + n;
  }

  function spellUrl(n) {
    n = parseInt(n, 10);
    if (!n) return "";
    if (n >= 1 && n <= 1000) return "paintings/" + n + ".jpg";
    try {
      if (typeof window.getSpellforgeSpellUrl === "function") {
        var raw = String(window.getSpellforgeSpellUrl(n) || "");
        if (raw) return raw.replace(/^\//, "");
      }
    } catch (e) {}
    if (n >= GEN_BASE && n < 200000) return "generated/" + (n - GEN_BASE) + ".jpg";
    if (n >= 200000 && n < 300000) return "sketches/" + (n - 200000) + ".png";
    if (n >= 300000 && n < 400000) return "sketches-inverted/" + (n - 300000) + ".png";
    return "paintings/" + n + ".jpg";
  }

  function spellFallbacks(n) {
    n = parseInt(n, 10);
    var urls = [];
    function add(u) {
      if (u && urls.indexOf(u) < 0) urls.push(u);
    }
    var primary = spellUrl(n);
    add(primary);
    if (n >= 1 && n <= 1000) {
      add("paintings/" + n + ".jpg");
      add("paintings/" + n + ".png");
    } else if (n >= GEN_BASE && n < 200000) {
      add("generated/" + (n - GEN_BASE) + ".jpg");
      add("generated/" + (n - GEN_BASE) + ".png");
    } else if (n >= 200000 && n < 300000) {
      add("sketches/" + (n - 200000) + ".png");
    } else if (n >= 300000 && n < 400000) {
      add("sketches-inverted/" + (n - 300000) + ".png");
    }
    if (primary && primary.indexOf("data:") !== 0) {
      add(apiUrl("/api/transfer/thumb?src=" + encodeURIComponent(primary) + "&w=220"));
    }
    return urls;
  }

  function setSpellImg(img, n) {
    if (!img) return;
    n = parseInt(n, 10);
    if (!n) {
      img.removeAttribute("src");
      img.removeAttribute("data-num");
      return;
    }
    if (img.getAttribute("data-num") === String(n) && img.getAttribute("src")) return;
    img.setAttribute("data-num", String(n));
    img.loading = "eager";
    img.decoding = "async";
    var urls = spellFallbacks(n);
    var i = 0;
    img.onerror = function () {
      i += 1;
      if (i < urls.length) img.src = urls[i];
      else img.onerror = null;
    };
    if (urls[0]) img.src = urls[0];
    else img.removeAttribute("src");
  }

  function pageSlice(page) {
    var list = bookList();
    var p = page == null ? state.bookPage | 0 : page;
    var start = p * BOOK_PAGE;
    return list.slice(start, start + BOOK_PAGE);
  }

  function preloadSpellNums(nums) {
    (nums || []).forEach(function (n) {
      n = parseInt(n, 10);
      if (!n) return;
      var urls = spellFallbacks(n);
      if (!urls[0]) return;
      var im = new Image();
      im.decoding = "async";
      im.src = urls[0];
    });
  }

  function hydrateSlotsFromForge() {
    var src = null;
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getEquippedSlots === "function") {
        src = window.SpellforgeAPI.getEquippedSlots();
      }
    } catch (e) {}
    if (!src || !src.length) {
      try {
        src = JSON.parse(localStorage.getItem("spellforge_equipped_v1") || "null");
      } catch (e2) {
        src = null;
      }
    }
    if (!Array.isArray(src)) return;
    var i;
    for (i = 0; i < 3; i++) {
      if (!state.slots[i] && src[i]) state.slots[i] = src[i];
    }
  }

  function ensureSlotsFromPage() {
    var slice = pageSlice(state.bookPage);
    if (!slice.length) return;
    var i;
    var changed = false;
    for (i = 0; i < 3; i++) {
      if (state.slots[i]) continue;
      if (slice[i]) {
        state.slots[i] = slice[i];
        changed = true;
      }
    }
    if (changed) saveState();
  }

  function armSpells() {
    bookList();
    hydrateSlotsFromForge();
    ensureSlotsFromPage();
    renderRing();
    preloadSpellNums(state.slots);
    preloadSpellNums(pageSlice(state.bookPage));
  }

  function bookList() {
    if (state.bookOrder && state.bookOrder.length) return state.bookOrder;
    var list = [];
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getDisplayOrder === "function") {
        list = window.SpellforgeAPI.getDisplayOrder() || [];
      }
    } catch (e) {}
    if (!list.length) {
      try {
        list = JSON.parse(localStorage.getItem("spellforge_display_order_v11") || "[]");
      } catch (e2) {
        list = [];
      }
    }
    if (!list.length) {
      var n;
      for (n = 1; n <= 1000; n++) list.push(n);
    }
    state.bookOrder = list;
    return list;
  }

  function domainMeta() {
    var id = state.domainId || "eukarya";
    var found = (state.domains || []).filter(function (d) {
      return d.id === id || d.name === id;
    })[0];
    return found || FALLBACK_DOMAINS[0];
  }

  function kingdomsForDomain() {
    var dom = domainMeta();
    var name = dom.name || "Eukarya";
    return (state.kingdoms || FALLBACK_KINGDOMS).filter(function (k) {
      return (k.domain || "") === name;
    });
  }

  function uniquePath() {
    var dom = domainMeta();
    var parts = [{ rank: "domain", name: dom.name || "Eukarya", key: dom.key || null }];
    var kingName = state.kingdomName || "";
    var kingKey = state.kingdomKey || null;
    if (kingName && kingName !== parts[0].name) {
      parts.push({ rank: "kingdom", name: kingName, key: kingKey });
    } else if (dom.id !== "eukarya" && kingName) {
      parts.push({ rank: "kingdom", name: kingName, key: kingKey || dom.key });
    }
    (state.trail || []).forEach(function (p) {
      if (!p || !p.name) return;
      var last = parts[parts.length - 1];
      if (last && last.name === p.name && last.rank === p.rank) return;
      if (p.name === kingName && p.rank === "kingdom") return;
      if (p.name === (dom.name || "") && p.rank === "domain") return;
      parts.push(p);
    });
    return parts;
  }

  function binomialOf(row) {
    if (!row) return "";
    var g = String(row.genus || "").trim();
    var s = String(row.species || row.scientific || row.canonicalName || "").trim();
    var low = s.toLowerCase();
    if (low === "animalia" || low === "eukarya") s = "";
    if (s.indexOf(" ") > 0) return s;
    if (g && s && s.toLowerCase().indexOf(g.toLowerCase()) !== 0) return g + " " + s;
    return s || g;
  }

  function domainForKingdom(kingdom) {
    var k = String(kingdom || "").toLowerCase();
    if (k === "bacteria") return "Bacteria";
    if (k === "archaea") return "Archaea";
    if (k === "viruses" || k === "virus") return "Virus (not a domain)";
    return "Eukarya";
  }

  function isSpamName(name) {
    var n = String(name || "").trim().toLowerCase();
    return n === "animalia" || n === "eukarya" || n === "animals";
  }

  function rankMeta(rank) {
    return RANK_META[rank] || { label: String(rank || ""), hint: "" };
  }

  function taxonPlain(name) {
    var n = String(name || "").trim().toLowerCase();
    if (!n) return "";
    if (TAXON_PLAIN[n]) return TAXON_PLAIN[n];
    var last = n.split(/\s+/).pop();
    return TAXON_PLAIN[last] || "";
  }

  function prettyTaxon(name, common) {
    var sci = String(name || "").trim();
    var plain = String(common || "").trim();
    if (isSpamName(plain)) plain = "";
    if (!plain) plain = taxonPlain(sci);
    if (plain && sci && plain.toLowerCase() !== sci.toLowerCase()) return plain + " (" + sci + ")";
    return plain || sci || "";
  }

  function rankGloss(rank) {
    var m = rankMeta(rank);
    return m.label + (m.hint ? " — " + m.hint : "");
  }

  function renderDomains() {
    var row = $("zoo-domains");
    if (!row) return;
    row.innerHTML = (state.domains || FALLBACK_DOMAINS)
      .map(function (d) {
        var gloss = taxonPlain(d.name) || d.note || "";
        return (
          '<button type="button" class="zoo-rank-btn' +
          (state.domainId === d.id ? " active" : "") +
          '" data-domain="' +
          escapeHtml(d.id) +
          '" title="' +
          escapeHtml(d.note || prettyTaxon(d.name)) +
          '">' +
          escapeHtml(d.name) +
          (gloss ? "<em>" + escapeHtml(gloss) + "</em>" : "") +
          "</button>"
        );
      })
      .join("");
  }

  function renderRealms() {
    var row = $("zoo-realms");
    if (!row) return;
    row.innerHTML = REALMS.map(function (r) {
      return (
        '<button type="button"' +
        (state.kingdomName === r.name ? ' class="active"' : "") +
        ' data-kingdom="' +
        escapeHtml(r.name) +
        '" data-key="' +
        r.key +
        '">' +
        escapeHtml(r.label) +
        "</button>"
      );
    }).join("");
    var rand = $("zoo-random");
    var rand2 = $("zoo-random-stage");
    var lab =
      state.kingdomName === "Plantae"
        ? "Random plant"
        : state.kingdomName === "Fungi"
          ? "Random fungus"
          : "Random animal";
    if (rand) rand.textContent = lab;
    if (rand2) rand2.textContent = lab;
  }

  function renderKingdoms() {
    var row = $("zoo-kingdoms");
    if (!row) return;
    var skip = { Animalia: 1, Plantae: 1, Fungi: 1 };
    var list = kingdomsForDomain().filter(function (k) {
      return !skip[k.name];
    });
    row.innerHTML = list
      .map(function (k) {
        var gloss = taxonPlain(k.name);
        return (
          '<button type="button" class="zoo-rank-btn' +
          (state.kingdomName === k.name ? " active" : "") +
          '" data-kingdom="' +
          escapeHtml(k.name) +
          '" data-key="' +
          escapeHtml(String(k.key || "")) +
          '" title="' +
          escapeHtml(prettyTaxon(k.name)) +
          '">' +
          escapeHtml(gloss ? gloss.charAt(0).toUpperCase() + gloss.slice(1) : k.name) +
          (gloss ? "<em>" + escapeHtml(k.name) + "</em>" : "") +
          "</button>"
        );
      })
      .join("");
  }

  function renderCats() {
    var row = $("zoo-cats");
    if (!row) return;
    var groups = (state.classes || []).filter(function (c) {
      var k = c.kingdom || "Animalia";
      return k === state.kingdomName;
    });
    if (!groups.length) {
      row.hidden = true;
      row.innerHTML = "";
      return;
    }
    row.hidden = false;
    var allLab =
      state.kingdomName === "Plantae"
        ? "All plants"
        : state.kingdomName === "Fungi"
          ? "All fungi"
          : "All animals";
    var html =
      '<button type="button" class="zoo-cat-btn' +
      (state.classId === "" ? " active" : "") +
      '" data-class="">' +
      escapeHtml(allLab) +
      "</button>";
    groups.forEach(function (c) {
      html +=
        '<button type="button" class="zoo-cat-btn' +
        (state.classId === c.id ? " active" : "") +
        '" data-class="' +
        escapeHtml(c.id) +
        '">' +
        escapeHtml(c.label || prettyTaxon(c.name)) +
        "</button>";
    });
    row.innerHTML = html;
  }

  function renderRanks() {
    var row = $("zoo-ranks");
    if (!row) return;
    row.innerHTML = RANKS.map(function (r) {
      var m = rankMeta(r);
      return (
        '<button type="button" class="zoo-rank-btn' +
        (state.rank === r ? " active" : "") +
        '" data-rank="' +
        r +
        '" title="' +
        escapeHtml(m.hint) +
        '">' +
        escapeHtml(m.label) +
        "<em>" +
        escapeHtml(m.chip || "") +
        "</em></button>"
      );
    }).join("");
  }

  function renderCrumb() {
    var el = $("zoo-crumb");
    if (!el) return;
    el.innerHTML = uniquePath()
      .map(function (p, i) {
        if (!p.name) return "";
        if (p.key) {
          return (
            '<button type="button" data-crumb="' +
            i +
            '" data-key="' +
            escapeHtml(String(p.key)) +
            '" data-rank="' +
            escapeHtml(p.rank || "") +
            '">' +
            escapeHtml(prettyTaxon(p.name)) +
            "</button>"
          );
        }
        return "<span>" + escapeHtml(prettyTaxon(p.name)) + "</span>";
      })
      .filter(Boolean)
      .join(" → ");
  }

  function renderList() {
    var list = $("zoo-list");
    if (!list) return;
    var rows = (state.list || []).filter(function (row) {
      var rank = String(row.rank || "species").toLowerCase();
      var label = row.canonicalName || row.scientific || row.common || "";
      if (state.rank === "species" && isSpamName(label) && rank !== "species") return false;
      if (rank === "kingdom" && isSpamName(label) && state.kingdomName === "Animalia" && state.rank === "species") {
        return false;
      }
      return true;
    });
    if (!rows.length) {
      list.innerHTML = '<p class="zoo-extract">No taxa in this slice. Search a common or scientific name, or open a rank above.</p>';
      return;
    }
    var selId = state.selected && (state.selected.id || state.selected.scientific);
    list.innerHTML = rows
      .map(function (row) {
        var id = row.id || row.scientific || row.key;
        var on = selId && (id === selId || row.scientific === (state.selected && state.selected.scientific));
        var rank = String(row.rank || "species").toLowerCase();
        var sci = binomialOf(row) || row.scientific || row.canonicalName || "";
        var common = row.common || "";
        if (isSpamName(common) && sci && sci.indexOf(" ") > 0) common = "";
        var title = prettyTaxon(sci || row.canonicalName, common) || "Unnamed";
        var sub = sci && title.indexOf("(" + sci + ")") < 0 && title !== sci ? sci : "";
        var src = imageUrl(row);
        var rm = rankMeta(rank);
        var rankLine =
          rm.label +
          (row.class && rank === "species"
            ? " · " + (taxonPlain(row.class) || row.class)
            : "");
        return (
          '<button type="button" class="zoo-card' +
          (on ? " selected" : "") +
          '" data-id="' +
          escapeHtml(String(id || "")) +
          '">' +
          (src
            ? '<img alt="" loading="lazy" src="' + escapeHtml(src) + '" />'
            : '<img alt="" />') +
          '<span class="zoo-card-meta"><strong>' +
          escapeHtml(title) +
          "</strong><em>" +
          escapeHtml(sub) +
          '</em><span class="zoo-card-rank">' +
          escapeHtml(rankLine) +
          "</span></span></button>"
        );
      })
      .join("");
  }

  function lineageOf(row) {
    if (!row) return [];
    var map = {};
    RANKS.forEach(function (r) {
      map[r] = { rank: r, name: "", key: null };
    });
    if (row.lineage && row.lineage.length) {
      row.lineage.forEach(function (p) {
        if (!p || !p.rank) return;
        var r = String(p.rank).toLowerCase();
        if (!map[r]) return;
        map[r].name = p.name || map[r].name;
        map[r].key = p.key || map[r].key;
      });
    }
    RANKS.forEach(function (r) {
      if (row[r] && !map[r].name) map[r].name = row[r];
      var keyName = r + "Key";
      if (row[keyName] && !map[r].key) map[r].key = row[keyName];
    });
    map.domain.name = map.domain.name || domainForKingdom(map.kingdom.name || row.kingdom);
    if (map.domain.name === "Eukarya") map.domain.key = null;
    var bin = binomialOf(row);
    if (bin) {
      map.species.name = bin;
      if (!map.genus.name && bin.indexOf(" ") > 0) map.genus.name = bin.split(" ")[0];
    }
    return RANKS.map(function (r) {
      return map[r];
    });
  }

  function packVal(item) {
    return String((item && item.key) || "") + "::" + String((item && (item.name || item.canonicalName)) || "");
  }

  function unpackVal(v) {
    v = String(v || "");
    var i = v.indexOf("::");
    if (i < 0) return { key: "", name: v };
    return { key: v.slice(0, i), name: v.slice(i + 2) };
  }

  function currentPick() {
    var map = {};
    RANKS.forEach(function (r) {
      map[r] = { rank: r, name: "", key: null };
    });
    var dom = domainMeta();
    map.domain = { rank: "domain", name: dom.name || "Eukarya", key: dom.key || null };
    map.kingdom = {
      rank: "kingdom",
      name: state.kingdomName || "",
      key: state.kingdomKey || null,
    };
    (state.trail || []).forEach(function (p) {
      if (p && p.rank && map[p.rank]) {
        map[p.rank] = { rank: p.rank, name: p.name || "", key: p.key || null };
      }
    });
    if (state.selected) {
      lineageOf(state.selected).forEach(function (p) {
        if (p && p.rank && p.name) {
          map[p.rank] = {
            rank: p.rank,
            name: p.name,
            key: p.key || map[p.rank].key,
          };
        }
      });
    }
    return map;
  }

  function parentPick(rank, pick) {
    pick = pick || currentPick();
    var i = RANKS.indexOf(rank);
    var j;
    for (j = i - 1; j >= 0; j--) {
      var p = pick[RANKS[j]];
      if (p && p.key) return p;
    }
    return null;
  }

  function taxonLabel(row, expectRank) {
    var sci = row.canonicalName || row.scientific || "";
    var common = row.common || "";
    var base = prettyTaxon(sci, common) || "Unnamed";
    var rr = String(row.rank || "").toLowerCase();
    if (expectRank && rr && rr !== expectRank && rr !== "unranked") {
      return rankMeta(rr).label + " · " + base;
    }
    return base;
  }

  function findCachedTaxon(key, name) {
    var bags = [state.list, state.featured];
    Object.keys(state.childCache || {}).forEach(function (k) {
      bags.push(state.childCache[k]);
    });
    var i;
    for (i = 0; i < bags.length; i++) {
      var rows = bags[i] || [];
      var j;
      for (j = 0; j < rows.length; j++) {
        var row = rows[j];
        if (!row) continue;
        if (key && String(row.key) === String(key)) return row;
        if (name && (row.canonicalName === name || row.scientific === name || row.common === name)) {
          return row;
        }
      }
    }
    return null;
  }

  function fetchChildren(key) {
    key = String(key || "");
    if (!key) return Promise.resolve([]);
    if (state.childCache[key]) return Promise.resolve(state.childCache[key]);
    if (state.childWait[key]) return state.childWait[key];
    state.childWait[key] = fetchJson(
      apiUrl("/api/zoo/children?key=" + encodeURIComponent(key) + "&limit=80"),
      25000
    )
      .then(function (d) {
        var rows = ((d && d.results) || []).filter(function (row) {
          var label = row.canonicalName || row.scientific || row.common || "";
          return !isSpamName(label) || String(row.rank || "").toLowerCase() === "kingdom";
        });
        state.childCache[key] = rows;
        delete state.childWait[key];
        return rows;
      })
      .catch(function () {
        delete state.childWait[key];
        return [];
      });
    return state.childWait[key];
  }

  function fillLineageSelects() {
    var el = $("zoo-lineage");
    if (!el) return;
    var pick = currentPick();
    var active = document.activeElement;
    var activeRank = active && active.getAttribute && active.getAttribute("data-rank");
    RANKS.forEach(function (rank) {
      var sel = el.querySelector('select[data-rank="' + rank + '"]');
      if (!sel) return;
      if (activeRank === rank && sel.options.length > 3) return;
      var cur = pick[rank] || {};
      var filled = !!(cur.name && String(cur.name).trim());
      sel.classList.toggle("missing", !filled);
      var wrap = sel.parentNode;
      if (wrap && wrap.classList) wrap.classList.toggle("missing", !filled);
      var meta = rankMeta(rank);
      var lab = el.querySelector('label[for="zoo-dd-' + rank + '"]');
      if (lab) {
        lab.textContent = meta.label;
        lab.title = meta.hint;
      }
      sel.setAttribute("aria-label", rankGloss(rank));
      sel.title = meta.hint;
      if (rank === "domain") {
        sel.disabled = false;
        sel.innerHTML = (state.domains || FALLBACK_DOMAINS)
          .map(function (d) {
            return (
              '<option value="' +
              escapeHtml(d.id) +
              '"' +
              (state.domainId === d.id ? " selected" : "") +
              ">" +
              escapeHtml(prettyTaxon(d.name) || d.name) +
              "</option>"
            );
          })
          .join("");
        return;
      }
      if (rank === "kingdom") {
        sel.disabled = false;
        var ks = kingdomsForDomain();
        sel.innerHTML =
          '<option value="">Choose ' +
          meta.label +
          "…</option>" +
          ks
            .map(function (k) {
              var val = packVal({ key: k.key, name: k.name });
              return (
                '<option value="' +
                escapeHtml(val) +
                '"' +
                (k.name === state.kingdomName ? " selected" : "") +
                ">" +
                escapeHtml(prettyTaxon(k.name)) +
                "</option>"
              );
            })
            .join("");
        return;
      }
      var parent = parentPick(rank, pick);
      var opts = parent && parent.key ? state.childCache[String(parent.key)] || [] : [];
      var html = '<option value="">Choose ' + meta.label + (meta.chip ? " — " + meta.chip : "") + "…</option>";
      var seen = {};
      opts.forEach(function (row) {
        var name = row.canonicalName || row.scientific || row.common || "";
        if (!name) return;
        var val = packVal({ key: row.key, name: name });
        if (seen[val]) return;
        seen[val] = true;
        var on =
          (cur.key && String(cur.key) === String(row.key)) ||
          (cur.name && (cur.name === name || cur.name === row.common));
        html +=
          '<option value="' +
          escapeHtml(val) +
          '"' +
          (on ? " selected" : "") +
          ">" +
          escapeHtml(taxonLabel(row, rank)) +
          "</option>";
      });
      if (filled) {
        var curVal = packVal(cur);
        if (!seen[curVal]) {
          html +=
            '<option value="' +
            escapeHtml(curVal) +
            '" selected>' +
            escapeHtml(prettyTaxon(cur.name)) +
            "</option>";
        }
      }
      sel.disabled = !(parent && parent.key);
      sel.innerHTML = html;
    });
  }

  function preloadLineageOptions() {
    var pick = currentPick();
    RANKS.forEach(function (rank, i) {
      if (i === 0) return;
      var parent = parentPick(rank, pick);
      if (!parent || !parent.key) return;
      if (state.childCache[String(parent.key)]) return;
      fetchChildren(parent.key).then(function () {
        fillLineageSelects();
      });
    });
  }

  function renderLineage() {
    var el = $("zoo-lineage");
    if (!el) return;
    if (!el.querySelector("select[data-rank]")) {
      el.innerHTML = RANKS.map(function (r) {
        var m = rankMeta(r);
        return (
          '<label class="k" for="zoo-dd-' +
          r +
          '" title="' +
          escapeHtml(m.hint) +
          '">' +
          escapeHtml(m.label) +
          "</label>" +
          '<span class="v"><select id="zoo-dd-' +
          r +
          '" class="zoo-dd missing" data-rank="' +
          r +
          '" aria-label="' +
          escapeHtml(rankGloss(r)) +
          '" title="' +
          escapeHtml(m.hint) +
          '"><option value="">Choose ' +
          escapeHtml(m.label) +
          "…</option></select></span>"
        );
      }).join("");
    }
    fillLineageSelects();
    preloadLineageOptions();
  }

  function applyClassChipTrail() {
    var found = (state.classes || []).filter(function (c) {
      return c.id === state.classId;
    })[0];
    state.trail = [];
    if (!found) return;
    if (found.phylum) {
      state.trail.push({
        rank: "phylum",
        name: found.phylum,
        key: found.phylumKey || null,
      });
    }
    state.trail.push({
      rank: found.rank || "class",
      name: found.name,
      key: found.key,
    });
    state.parentKey = found.key || state.kingdomKey;
  }

  function applyLineageRank(rank, packed) {
    if (rank === "domain") {
      setDomain(packed || unpackVal(packed).name);
      return;
    }
    if (rank === "kingdom") {
      var k = unpackVal(packed);
      if (!k.name) return;
      setKingdom(k.name, k.key);
      return;
    }
    var u = unpackVal(packed);
    var child = u.key || u.name ? findCachedTaxon(u.key, u.name) : null;
    var childRank = child && child.rank ? String(child.rank).toLowerCase() : rank;
    if (childRank === "subspecies") childRank = "species";
    if (RANKS.indexOf(childRank) < 0) childRank = rank;
    var cut = RANKS.indexOf(childRank);
    state.trail = (state.trail || []).filter(function (p) {
      var i = RANKS.indexOf(p.rank);
      return i > RANKS.indexOf("kingdom") && i < cut;
    });
    if (u.name) {
      state.trail.push({
        rank: childRank,
        name: child ? child.canonicalName || child.scientific || u.name : u.name,
        key: u.key || (child && child.key) || null,
      });
    }
    state.parentKey = u.key || state.kingdomKey;
    state.rank = u.name ? nextRank(childRank) : rank;
    if (childRank === "class" || rank === "class") {
      var chip = (state.classes || []).filter(function (c) {
        return c.name === u.name || String(c.key) === String(u.key);
      })[0];
      state.classId = chip ? chip.id : "";
      renderCats();
    }
    if (childRank === "phylum" || rank === "phylum") {
      if (childRank !== "class") state.classId = "";
      renderCats();
    }
    renderCrumb();
    renderRanks();
    if ((childRank === "species" || rank === "species") && u.name) {
      var row =
        child || {
          rank: "species",
          scientific: u.name,
          canonicalName: u.name,
          common: u.name,
          key: u.key || null,
          genus: u.name.indexOf(" ") > 0 ? u.name.split(" ")[0] : "",
          species: u.name,
        };
      selectCreature(row);
      return;
    }
    state.selected = null;
    state.genUrl = "";
    renderCreature();
    renderExtract();
    fillLineageSelects();
    preloadLineageOptions();
    if (u.key) loadChildren(u.key, rank);
    else {
      state.list = [];
      renderList();
    }
  }

  function renderExtract() {
    var el = $("zoo-extract");
    if (!el) return;
    var row = state.selected;
    el.textContent = (row && (row.extract || row.description)) || "";
  }

  function stockKey(row) {
    if (!row) return "";
    return String(row.key || row.id || row.scientific || row.canonicalName || row.common || "");
  }

  function placeholderDataUrl(row) {
    var common = row && row.common && !isSpamName(row.common) ? row.common : "";
    var sci = (row && (binomialOf(row) || row.scientific || row.canonicalName)) || "";
    var title = common || sci || "taxon";
    var sub = common && sci && sci !== common ? sci : "";
    var c = document.createElement("canvas");
    c.width = 800;
    c.height = 800;
    var ctx = c.getContext("2d");
    var g = ctx.createRadialGradient(320, 240, 40, 400, 400, 520);
    g.addColorStop(0, "#3a4a28");
    g.addColorStop(1, "#101408");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 800);
    ctx.beginPath();
    ctx.arc(400, 355, 210, 0, Math.PI * 2);
    ctx.fillStyle = "#1c2614";
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#c9b86a";
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(400, 430, 150, 90, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#2a3820";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(400, 300, 78, 0, Math.PI * 2);
    ctx.fillStyle = "#4a5c30";
    ctx.fill();
    ctx.fillStyle = "#f0e8c0";
    ctx.font = "32px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(String(title).slice(0, 36), 400, 640);
    if (sub) {
      ctx.fillStyle = "#b8c898";
      ctx.font = "italic 20px Georgia, serif";
      ctx.fillText(String(sub).slice(0, 42), 400, 678);
    }
    return c.toDataURL("image/jpeg", 0.86);
  }

  function cacheRushedStock(row, url) {
    if (!url) return;
    toDataUrl(url)
      .then(function (dataUrl) {
        if (!dataUrl || dataUrl.indexOf("data:image") !== 0) return;
        return fetch(apiUrl("/api/zoo/cache-image"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scientific: (row && (binomialOf(row) || row.scientific)) || "",
            common: (row && row.common) || "",
            image_base64: dataUrl,
          }),
        });
      })
      .catch(function () {});
  }

  function rushStock(row, token) {
    if (!row) return;
    var key = stockKey(row);
    if (state.rushing && state.stockLoading === key) return;
    state.rushing = true;
    var label =
      (row.common && !isSpamName(row.common) ? row.common : "") ||
      binomialOf(row) ||
      row.scientific ||
      row.canonicalName ||
      "this taxon";
    var sci = binomialOf(row) || row.scientific || label;
    setStatus("No library photo — rushing a field still of " + label + "…", "pending");
    var stasis =
      "Documentary wildlife photograph of " +
      label +
      " (" +
      sci +
      "). Living specimen in natural habitat, species-accurate anatomy and markings. " +
      "True field-discovery photo, fill the frame, no text, no collage, no merch, no circular badge, no T-shirt print.";
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "zoo-stock-" + Date.now();
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: stasis,
        prompt: "Field photograph of " + label + ", species-accurate, natural habitat, fill the frame.",
        fused_prompt: stasis,
        buzz_words: ["wildlife photography", "field photo", "species accurate", "no overlay"],
        spells: [],
        aspect_ratio: "1:1",
        mag_fresh: true,
        fresh_variation: true,
        spell_cast: false,
        attach_references: false,
        reference_image: "",
        source: "zoo-stock",
        product_mode: "original_fusion",
      }),
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (r.status === 202 || (d && d.job_id)) return pollJob(d.job_id || jobId);
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          if (d.job_id) return pollJob(d.job_id);
          throw new Error("Rush generate returned no still");
        });
      })
      .then(function (url) {
        if (token !== state.stockToken || !url) return;
        if (url.indexOf("http") !== 0 && url.indexOf("data:") !== 0 && url.indexOf("/") !== 0) {
          url = "/" + url;
        }
        var img = $("zoo-stock");
        if (img && !(state.view === "generated" && state.genUrl)) {
          img.hidden = false;
          img.src = url.indexOf("/") === 0 ? apiUrl(url) : url;
        }
        state.stockReady = true;
        state.stockKey = key;
        cacheRushedStock(row, url.indexOf("/") === 0 ? apiUrl(url) : url);
        setStatus("Rushed a field still of " + label + " into the circle.", "ok");
      })
      .catch(function () {
        if (token !== state.stockToken) return;
        setStatus("Showing a stand-in for " + label + " — library photo unavailable.", "pending");
      })
      .then(function () {
        if (token === state.stockToken) state.rushing = false;
      });
  }

  function ensureStock(row) {
    var img = $("zoo-stock");
    if (!img || !row) return;
    var key = stockKey(row);
    if (state.stockKey === key && state.stockReady) {
      img.hidden = state.view === "generated" && !!state.genUrl;
      return;
    }
    if (state.stockLoading === key) return;
    state.stockLoading = key;
    state.stockReady = false;
    var token = ++state.stockToken;
    var ph = placeholderDataUrl(row);
    if (!(state.view === "generated" && state.genUrl)) {
      img.hidden = false;
      img.src = ph;
    }
    var url = imageUrl(row);
    if (!url) {
      rushStock(row, token);
      return;
    }
    fetch(url, { cache: "default" })
      .then(function (r) {
        if (token !== state.stockToken) return null;
        var kind = String(r.headers.get("X-Zoo-Stock") || "").toLowerCase();
        if (!r.ok) {
          rushStock(row, token);
          return null;
        }
        return r.blob().then(function (blob) {
          return { blob: blob, kind: kind, type: String(blob.type || "") };
        });
      })
      .then(function (pack) {
        if (!pack || token !== state.stockToken) return;
        var isPlace =
          pack.kind === "placeholder" ||
          pack.type.indexOf("svg") >= 0 ||
          (pack.blob && pack.blob.size < 1200);
        if (isPlace) {
          rushStock(row, token);
          return;
        }
        var obj = URL.createObjectURL(pack.blob);
        if (!(state.view === "generated" && state.genUrl)) {
          img.hidden = false;
          img.src = obj;
        }
        state.stockReady = true;
        state.stockKey = key;
      })
      .catch(function () {
        if (token !== state.stockToken) return;
        rushStock(row, token);
      });
  }

  function renderCreature() {
    var imgStock = $("zoo-stock");
    var imgGen = $("zoo-gen-circle");
    var empty = $("zoo-creature-empty");
    var row = state.selected;
    var showGen = state.view === "generated" && state.genUrl;
    if (imgStock) {
      imgStock.hidden = !row || showGen;
      if (row) ensureStock(row);
    }
    if (imgGen) {
      imgGen.hidden = !showGen;
      if (showGen) imgGen.src = state.genUrl;
    }
    if (empty) empty.hidden = !!row;
    var genFrame = $("zoo-gen-preview");
    var genEmpty = $("zoo-gen-empty");
    if (genFrame) {
      genFrame.hidden = !state.genUrl;
      if (state.genUrl) genFrame.src = state.genUrl;
    }
    if (genEmpty) genEmpty.hidden = !!state.genUrl;
    document.querySelectorAll(".zoo-view-toggle button").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-view") === state.view);
    });
  }

  function renderRing() {
    var svg = $("zoo-ring");
    if (!svg) return;
    var cx = 200;
    var cy = 200;
    var r0 = 132;
    var r1 = 196;
    var spans = [
      [210, 330],
      [330, 90],
      [90, 210],
    ];
    var paths = spans
      .map(function (pair, i) {
        var d = annularPath(cx, cy, r0, r1, pair[0], pair[1]);
        var on = state.slots[i] ? " on" : "";
        return (
          '<path class="' +
          on.trim() +
          '" data-slot="' +
          i +
          '" d="' +
          d +
          '"><title>Spell ' +
          ROMAN[i] +
          "</title></path>"
        );
      })
      .join("");
    svg.innerHTML = paths;
    var mids = [270, 30, 150];
    var rMid = (r0 + r1) / 2;
    var i;
    for (i = 0; i < 3; i++) {
      var well = $("zoo-slot-" + i);
      if (!well) continue;
      var pt = polar(50, 50, (rMid / 400) * 100, mids[i]);
      well.style.left = pt[0] + "%";
      well.style.top = pt[1] + "%";
      var img = well.querySelector("img");
      var lab = well.querySelector("span");
      var n = state.slots[i];
      well.classList.toggle("empty", !n);
      if (lab) lab.textContent = n ? "Spell " + ROMAN[i] + " " + spellLabel(n) : "Spell " + ROMAN[i];
      if (img) {
        img.loading = "eager";
        img.decoding = "async";
        if (n) setSpellImg(img, n);
        else {
          img.removeAttribute("src");
          img.removeAttribute("data-num");
        }
      }
    }
  }

  function renderBook() {
    var box = $("zoo-book");
    if (!box || !box.classList.contains("on")) return;
    var list = bookList();
    var pages = Math.max(1, Math.ceil(list.length / BOOK_PAGE));
    if (state.bookPage < 0) state.bookPage = 0;
    if (state.bookPage >= pages) state.bookPage = pages - 1;
    var slotEl = $("zoo-book-slot");
    var pageEl = $("zoo-book-page");
    if (slotEl) slotEl.textContent = "Spell " + ROMAN[state.bookSlot | 0];
    if (pageEl) pageEl.textContent = "Page " + (state.bookPage + 1) + " / " + pages;
    var grid = $("zoo-book-grid");
    if (!grid) return;
    var start = state.bookPage * BOOK_PAGE;
    var slice = list.slice(start, start + BOOK_PAGE);
    var equipped = state.slots[state.bookSlot | 0];
    grid.innerHTML = "";
    slice.forEach(function (n) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zoo-book-tile" + (Number(n) === Number(equipped) ? " on" : "");
      btn.setAttribute("data-num", String(n));
      var img = document.createElement("img");
      img.alt = "";
      img.loading = "eager";
      img.decoding = "async";
      var lab = document.createElement("span");
      lab.textContent = spellLabel(n);
      btn.appendChild(img);
      btn.appendChild(lab);
      grid.appendChild(btn);
      setSpellImg(img, n);
    });
    preloadSpellNums(slice);
  }

  function openBook(slot) {
    if (slot == null || isNaN(slot)) slot = state.bookSlot | 0;
    state.bookSlot = slot | 0;
    var list = bookList();
    var cur = state.slots[state.bookSlot] || 0;
    var idx = list.indexOf(cur);
    if (idx < 0) idx = list.indexOf(parseInt(cur, 10));
    if (idx >= 0) state.bookPage = Math.floor(idx / BOOK_PAGE);
    var box = $("zoo-book");
    if (box) {
      box.hidden = false;
      box.classList.add("on");
    }
    renderBook();
    preloadSpellNums(pageSlice(state.bookPage));
    setStatus("Pick a gallery spell for slot " + ROMAN[state.bookSlot] + ".");
  }

  function closeBook() {
    var box = $("zoo-book");
    if (box) {
      box.classList.remove("on");
      box.hidden = true;
    }
  }

  function chooseSpell(n) {
    n = parseInt(n, 10);
    if (!n) return;
    state.slots[state.bookSlot | 0] = n;
    saveState();
    renderRing();
    renderBook();
    setStatus("Slot " + ROMAN[state.bookSlot] + " → " + spellLabel(n));
  }

  function classKey() {
    var id = state.classId;
    var found = (state.classes || []).filter(function (c) {
      return c.id === id;
    })[0];
    return found && found.key ? found.key : "";
  }

  function featuredForView() {
    var rows = state.featured || [];
    var king = state.kingdomName || "Animalia";
    rows = rows.filter(function (c) {
      return (c.kingdom || "Animalia") === king;
    });
    if (state.classId) {
      rows = rows.filter(function (c) {
        return c.classId === state.classId;
      });
    }
    return rows;
  }

  function randomAnimal(ev) {
    var stay = !!(ev && ev.shiftKey);
    var pool = (state.featured || []).filter(function (c) {
      if (!c || !(c.scientific || c.canonicalName || c.common)) return false;
      return (c.kingdom || "Animalia") === (state.kingdomName || "Animalia");
    });
    if (stay) {
      var scoped = featuredForView().filter(function (c) {
        return c && (c.scientific || c.canonicalName || c.common);
      });
      if (scoped.length) pool = scoped;
    }
    if (!pool.length) {
      setStatus("Loading catalog for a random pick…", "pending");
      fetchJson(apiUrl("/api/zoo/catalog"), 20000)
        .then(function (d) {
          state.featured = (d && d.creatures) || state.featured || [];
          if (d && d.classes) state.classes = d.classes;
          if (!(state.featured && state.featured.length)) {
            setStatus("No featured animals in the catalog.", "error");
            return;
          }
          randomAnimal(ev);
        })
        .catch(function () {
          setStatus("Could not load animals for Random.", "error");
        });
      return;
    }
    var cur = state.selected
      ? String(state.selected.id || state.selected.scientific || state.selected.canonicalName || "")
      : "";
    var picks = pool.filter(function (c) {
      return String(c.id || c.scientific || c.canonicalName || "") !== cur;
    });
    if (!picks.length) picks = pool;
    var row = picks[Math.floor(Math.random() * picks.length)];
    state.q = "";
    if ($("zoo-search")) $("zoo-search").value = "";
    if (row.domain) {
      var d = (state.domains || FALLBACK_DOMAINS).filter(function (x) {
        return x.name === row.domain;
      })[0];
      if (d) state.domainId = d.id;
    } else {
      state.domainId = "eukarya";
    }
    state.kingdomName = row.kingdom || "Animalia";
    var kingKeys = { Animalia: 1, Plantae: 6, Fungi: 5, Chromista: 4, Protozoa: 7, Bacteria: 3, Archaea: 2 };
    state.kingdomKey = row.kingdomKey || kingKeys[state.kingdomName] || state.kingdomKey;
    state.classId = row.classId || "";
    applyClassChipTrail();
    state.rank = "species";
    saveState();
    renderRealms();
    renderDomains();
    renderKingdoms();
    renderCats();
    renderRanks();
    renderCrumb();
    state.list = featuredForView();
    renderList();
    selectCreature(row);
    var label = row.common || row.scientific || "animal";
    setStatus(
      "Random" + (stay ? " in this class" : "") + ": " + label + " — stock in the circle, ready to Cast.",
      "ok"
    );
  }

  function loadList() {
    var q = state.q;
    if (!q) {
      state.list = featuredForView();
      renderList();
      setStatus(state.list.length ? state.list.length + " in this slice — loading more…" : "Loading more species…");
      var higher = classKey() || state.kingdomKey;
      if (!higher) return Promise.resolve();
      var extra = [
        "limit=40",
        "rank=SPECIES",
        "highertaxonKey=" + encodeURIComponent(higher),
      ];
      if (state.kingdomName) extra.push("kingdom=" + encodeURIComponent(state.kingdomName));
      return fetchJson(apiUrl("/api/zoo/search?" + extra.join("&")), 25000)
        .then(function (d) {
          var seen = {};
          var merged = [];
          function add(row) {
            if (!row) return;
            var sci = String(row.scientific || row.canonicalName || "").toLowerCase();
            if (!sci || isSpamName(sci) || seen[sci]) return;
            if (String(row.rank || "species").toLowerCase() !== "species" && sci.indexOf(" ") < 0) return;
            seen[sci] = true;
            merged.push(row);
          }
          (state.list || []).forEach(add);
          ((d && d.results) || []).forEach(add);
          state.list = merged;
          renderList();
          setStatus(merged.length + " species in this slice");
        })
        .catch(function () {
          setStatus((state.list || []).length + " featured in this slice");
        });
    }
    var params = ["limit=28", "q=" + encodeURIComponent(q), "rank=SPECIES"];
    var higher = classKey() || state.kingdomKey;
    if (higher) params.push("highertaxonKey=" + encodeURIComponent(higher));
    if (state.kingdomName) params.push("kingdom=" + encodeURIComponent(state.kingdomName));
    setStatus("Searching GBIF…", "pending");
    return fetchJson(apiUrl("/api/zoo/search?" + params.join("&")), 25000)
      .then(function (d) {
        var rows = ((d && d.results) || []).filter(function (row) {
          var label = row.canonicalName || row.scientific || "";
          return !isSpamName(label);
        });
        state.list = rows;
        renderList();
        setStatus(rows.length ? rows.length + " matches" : "No matches");
      })
      .catch(function (err) {
        state.list = featuredForView().filter(function (c) {
          var blob = (c.common + " " + c.scientific).toLowerCase();
          return blob.indexOf(q.toLowerCase()) >= 0;
        });
        renderList();
        setStatus((err && err.message) || "Local catalog only", "error");
      });
  }

  function loadChildren(key, rank) {
    setStatus("Opening " + (rank || "rank") + "…", "pending");
    return fetchChildren(key)
      .then(function (rows) {
        var parentName = (
          uniquePath().filter(function (p) {
            return String(p.key) === String(key);
          })[0] || {}
        ).name;
        state.list = (rows || []).filter(function (row) {
          var label = row.canonicalName || row.scientific || row.common || "";
          if (parentName && label === parentName) return false;
          return true;
        });
        state.parentKey = key;
        renderList();
        renderCrumb();
        fillLineageSelects();
        setStatus(state.list.length + " child taxa");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not load children", "error");
      });
  }

  function selectCreature(row) {
    if (!row) return;
    var rank = String(row.rank || "species").toLowerCase();
    if (row.key && rank && rank !== "species" && rank !== "subspecies") {
      if (rank === "domain") {
        setDomain(String(row.canonicalName || row.name || row.common || "").toLowerCase());
        return;
      }
      if (rank === "kingdom") {
        setKingdom(row.canonicalName || row.scientific || row.common, row.key);
        return;
      }
      var step = {
        rank: rank,
        name: row.canonicalName || row.scientific || row.common,
        key: row.key,
      };
      var trail = (state.trail || []).filter(function (p) {
        var i = RANKS.indexOf(p.rank);
        return i >= 0 && i < RANKS.indexOf(rank);
      });
      trail.push(step);
      state.trail = trail;
      state.rank = nextRank(rank);
      state.parentKey = row.key;
      renderRanks();
      renderCrumb();
      loadChildren(row.key, rank);
      return;
    }
    state.selected = row;
    state.view = "stock";
    state.genUrl = "";
    renderList();
    renderLineage();
    renderExtract();
    renderCreature();
    setStatus("Resolving full classification for " + (row.common || row.scientific) + "…", "pending");
    var qs = [];
    if (row.key) qs.push("key=" + encodeURIComponent(row.key));
    if (row.scientific) qs.push("scientific=" + encodeURIComponent(row.scientific));
    if (row.common) qs.push("q=" + encodeURIComponent(row.common));
    fetchJson(apiUrl("/api/zoo/taxon?" + qs.join("&")), 30000)
      .then(function (d) {
        var t = d && d.taxon;
        if (!t) return;
        state.selected = Object.assign({}, row, t);
        renderLineage();
        renderExtract();
        renderCreature();
        renderList();
        var missing = lineageOf(state.selected)
          .filter(function (p) {
            return !p.name;
          })
          .map(function (p) {
            return p.rank;
          });
        setStatus(
          (state.selected.common || binomialOf(state.selected) || "species") +
            (missing.length ? " · unresolved " + missing.join(", ") : " · full eight ranks") +
            " · stock for the circle, Cast blends descriptions",
          missing.length ? "pending" : "ok"
        );
      })
      .catch(function () {
        setStatus("Using catalog ranks — live GBIF enrich failed", "pending");
      });
  }

  function nextRank(rank) {
    var i = RANKS.indexOf(String(rank || "").toLowerCase());
    if (i < 0 || i >= RANKS.length - 1) return "species";
    return RANKS[i + 1];
  }

  function findCard(id) {
    var i;
    for (i = 0; i < state.list.length; i++) {
      var row = state.list[i];
      if (String(row.id) === String(id) || String(row.scientific) === String(id) || String(row.key) === String(id)) {
        return row;
      }
    }
    return null;
  }

  function analysisOf(n) {
    n = parseInt(n, 10);
    if (!n) return null;
    var keys = [n, String(n)];
    if (n >= GEN_BASE && n < 200000) {
      keys.push(n - GEN_BASE, String(n - GEN_BASE));
    } else if (n >= 200000 && n < 300000) {
      keys.push(n - 200000, String(n - 200000));
    } else if (n >= 300000 && n < 400000) {
      keys.push(n - 300000, String(n - 300000));
    }
    var bags = [state.analyses, state.lod1];
    try {
      var ga = window.getGalleryAnalyses ? window.getGalleryAnalyses() : window.galleryAnalyses;
      if (ga) bags.push(ga);
    } catch (e) {}
    var b;
    var k;
    for (b = 0; b < bags.length; b++) {
      var bag = bags[b];
      if (!bag) continue;
      for (k = 0; k < keys.length; k++) {
        var a = bag[keys[k]];
        if (a && typeof a === "object" && (a.description || a.prompt || a.title || a.colors)) {
          return a;
        }
      }
    }
    return null;
  }

  function spellDNA(n) {
    var a = analysisOf(n) || {};
    var parts = [];
    parts.push("Spell " + spellLabel(n) + (a.title ? ' "' + a.title + '"' : "") + " — COMPOSITION to reuse:");
    if (a.description) parts.push("Staging, masses, and mark-making: " + a.description);
    if (a.prompt) parts.push("Painterly language: " + a.prompt);
    if (a.style) parts.push("Style: " + a.style);
    if (a.mood) parts.push("Mood: " + a.mood);
    if (a.medium) parts.push("Medium: " + a.medium);
    if (a.colors && a.colors.length) parts.push("Mandatory pigments: " + a.colors.join(", "));
    if (a.tags && a.tags.length) parts.push("Motifs: " + a.tags.join(", "));
    var text = parts.join("\n");
    if (text.replace(/\s+/g, " ").length > 80) return text;
    return (
      "Spell " +
      spellLabel(n) +
      " — reuse this painting's crop, gesture, color weather, and brush architecture as the frame. " +
      "Keep those compositional decisions. Replace only the original subject with the chosen species."
    );
  }

  function loadAnalyses() {
    var jobs = [];
    if (!state.analyses) {
      jobs.push(
        fetch("data/analyses.json", { cache: "force-cache" })
          .then(function (r) {
            return r.ok ? r.json() : {};
          })
          .then(function (d) {
            state.analyses = d && typeof d === "object" ? d : {};
          })
          .catch(function () {
            state.analyses = {};
          })
      );
    }
    if (!state.lod1) {
      jobs.push(
        fetch(apiUrl("/api/lod1-analyses?t=" + Date.now()), { cache: "default" })
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (d) {
            if (d && typeof d === "object") state.lod1 = d.analyses || d;
          })
          .catch(function () {})
      );
    }
    if (typeof window.loadGalleryData === "function") {
      jobs.push(window.loadGalleryData().catch(function () {}));
    }
    return Promise.all(jobs);
  }

  function taxonomyLine(row) {
    return lineageOf(row)
      .map(function (p) {
        return p.name ? p.rank.charAt(0).toUpperCase() + p.rank.slice(1) + " " + p.name : "";
      })
      .filter(Boolean)
      .join(" → ");
  }

  function composeCast(userPrompt) {
    var row = state.selected;
    var common = row.common && !isSpamName(row.common) ? row.common : "";
    var sci = binomialOf(row) || row.scientific || row.canonicalName || common || "this species";
    var label = common ? common + " (" + sci + ")" : sci;
    var lineage = taxonomyLine(row);
    var slots = (state.slots || []).filter(Boolean);
    var bodies = [];
    var details = [];
    var pigments = [];
    slots.forEach(function (n, i) {
      var dna = spellDNA(n);
      bodies.push("── SPELL COMPOSITION " + ROMAN[i] + " (" + spellLabel(n) + ") ──\n" + dna);
      var a = analysisOf(n) || {};
      (a.colors || []).forEach(function (c) {
        if (c && pigments.indexOf(c) < 0) pigments.push(c);
      });
      details.push({
        number: n >= 1 && n <= 1000 ? n : 0,
        title: a.title || spellLabel(n),
        description: String(a.description || a.prompt || dna).slice(0, 1800),
        prompt: String(a.prompt || "").slice(0, 800),
        style: a.style || "",
        mood: a.mood || "",
        tags: (a.tags || []).slice(0, 8),
        colors: (a.colors || []).slice(0, 8),
        source: "influence-text",
        slot: i,
      });
    });
    var extra = String(userPrompt || "").trim();
    var artist = (window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) || "Logan Sevin";
    var notes = String(row.extract || "").slice(0, 360);
    var spellNames = slots.map(spellLabel).join(" + ");
    var stasis =
      "ZOO SPELL CAST — one authored still. Hero subject: a living " +
      label +
      ". Species identity is mandatory (true anatomy, diagnostic markings, recognizable silhouette). " +
      "The equipped gallery spells supply COMPOSITION, not a new subject.\n" +
      "Use the spells' crop, gesture, masses, depth, pigment weather, and brush architecture as the frame this creature lives inside. " +
      "If three spells are equipped, braid their compositions into one hybrid staging. " +
      "Do not collage the source paintings as pictures-in-picture. Do not paste a stock photograph. Do not print merch or a T-shirt. " +
      "Do not invent a generic wildlife postcard that ignores the spells.\n" +
      "Classification: " +
      lineage +
      ".\n" +
      (notes ? "Field notes: " + notes + "\n" : "") +
      "Studio author: " +
      artist +
      ".\n" +
      (spellNames ? "Equipped compositions: " + spellNames + ".\n" : "") +
      (pigments.length ? "Carry these pigments through the scene: " + pigments.slice(0, 12).join(", ") + ".\n" : "") +
      "\n" +
      (bodies.length
        ? bodies.join("\n\n") + "\n\n"
        : "") +
      "FUSION: One continuous painting. " +
      label +
      " is the protagonist occupying the compositional focus those spells would give a hero. " +
      "Spell worlds become habitat, light, weather, and surface — still clearly this species. Fill the canvas; no letterbox; no stacked panels.\n" +
      (extra ? "Extra direction: " + extra + "\n" : "");
    var prompt =
      label +
      " as the sole living hero, composed like equipped spells " +
      (spellNames || "the gallery") +
      " — species-accurate, spell-composed, not a stock reprint. " +
      (extra ? extra + " " : "") +
      "Fill the frame.";
    return {
      stasis: stasis.slice(0, 7200),
      prompt: prompt.slice(0, 1800),
      buzz_words: [
        "spell composition",
        "species as hero",
        "braided staging",
        "gallery pigments",
        "no collage",
        "no stock overlay",
        "one scene",
      ].concat(pigments.slice(0, 6)),
      spells: slots.filter(function (n) {
        return n >= 1 && n <= 1000;
      }),
      spell_details: details,
    };
  }

  function toDataUrl(url) {
    if (!url) return Promise.resolve("");
    if (String(url).indexOf("data:") === 0) return Promise.resolve(url);
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("Stock image fetch failed");
        return r.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          var obj = URL.createObjectURL(blob);
          img.onload = function () {
            var max = 960;
            var scale = Math.min(1, max / Math.max(img.width, img.height, 1));
            var c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(img.width * scale));
            c.height = Math.max(1, Math.round(img.height * scale));
            var ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(obj);
            resolve(c.toDataURL("image/jpeg", 0.88));
          };
          img.onerror = function () {
            URL.revokeObjectURL(obj);
            reject(new Error("Could not decode stock photo"));
          };
          img.src = obj;
        });
      });
  }

  function pollJob(jobId, left) {
    left = left == null ? 90 : left;
    if (left <= 0) return Promise.reject(new Error("Generate timed out"));
    return fetch(apiUrl("/api/jobs/" + jobId), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        var st = String((job && job.status) || "working").toLowerCase();
        setStatus("Casting… " + st, "pending");
        if (st === "done" || st === "completed" || st === "success") {
          var img = (job.images && job.images[0]) || job.image;
          var url = img && img.url;
          if (url) return url;
          throw new Error("Job done but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          var err = job.error;
          throw new Error((err && err.message) || err || "Generate failed");
        }
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            pollJob(jobId, left - 1).then(resolve, reject);
          }, 2000);
        });
      });
  }

  function saveGenerated(url, title) {
    var payload = {
      image_url: url,
      title: title,
      source: "zoo",
      collection: "generated",
      description: title,
    };
    var chain = Promise.resolve();
    if (String(url).indexOf("data:") === 0) {
      payload.image_base64 = url;
      delete payload.image_url;
    }
    return chain.then(function () {
      return fetch(apiUrl("/api/save-generated-image"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(function (r) {
        return r.json().catch(function () {
          return {};
        });
      });
    });
  }

  function cast() {
    if (state.casting) return;
    var row = state.selected;
    if (!row) {
      setStatus("Pick a creature first.", "error");
      return;
    }
    var promptEl = $("zoo-prompt");
    var extra = promptEl ? String(promptEl.value || "").trim() : "";
    armSpells();
    if (!(state.slots || []).filter(Boolean).length) {
      setStatus("Need spells in the three arcs first — they should load from the current book page.", "error");
      return;
    }
    state.casting = true;
    $("zoo-cast") && ($("zoo-cast").disabled = true);
    setStatus("Reading spell compositions…", "pending");
    loadAnalyses()
      .then(function () {
        var pack = composeCast(extra);
        if (!pack.spell_details || !pack.spell_details.length) {
          throw new Error("Spell compositions did not load. Open an arc and pick three stills.");
        }
        var jobId =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : "zoo-" + Date.now();
        var body = {
          job_id: jobId,
          stasis: pack.stasis,
          prompt: pack.prompt,
          fused_prompt: pack.stasis,
          buzz_words: pack.buzz_words,
          spells: pack.spells,
          spell_details: pack.spell_details,
          aspect_ratio: state.aspect || "1:1",
          mag_fresh: true,
          fresh_variation: true,
          spell_cast: false,
          attach_references: false,
          reference_image: "",
          spell_reference_image: "",
          source: "zoo",
        };
        setStatus(
          "Casting " +
            (row.common || binomialOf(row) || "this species") +
            " through " +
            pack.spell_details.length +
            " spell composition" +
            (pack.spell_details.length === 1 ? "" : "s") +
            "…",
          "pending"
        );
        return fetch(apiUrl("/api/generate-stasis-vision"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        }).then(function (r) {
          return r.json().then(function (d) {
            if (r.status === 202 || (d && (d.job_id || jobId) && (d.status === "queued" || d.status === "pending"))) {
              return pollJob(d.job_id || jobId);
            }
            if (!r.ok) {
              var errMsg = (d && d.error && d.error.message) || d.error || "Generate failed";
              throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
            }
            var img = d.image || (d.images && d.images[0]);
            if (img && img.url) return img.url;
            if (d.job_id) return pollJob(d.job_id);
            throw new Error("No image returned");
          });
        });
      })
      .then(function (url) {
        if (!url) throw new Error("Cast finished with no still.");
        if (url.indexOf("http") !== 0 && url.indexOf("data:") !== 0 && url.indexOf("/") !== 0) {
          url = "/" + url;
        }
        state.genUrl = url;
        state.view = "generated";
        renderCreature();
        var title = "Zoo — " + (row.common || row.scientific);
        saveGenerated(url, title).catch(function () {});
        setStatus("Cast complete — generative " + (row.common || "creature") + " saved to Generated.", "ok");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Cast failed", "error");
      })
      .then(function () {
        state.casting = false;
        $("zoo-cast") && ($("zoo-cast").disabled = false);
      });
  }

  function setDomain(id) {
    id = String(id || "eukarya").toLowerCase();
    if (id.indexOf("eukarya") >= 0) id = "eukarya";
    else if (id.indexOf("bacter") >= 0) id = "bacteria";
    else if (id.indexOf("archae") >= 0) id = "archaea";
    state.domainId = id;
    state.trail = [];
    state.classId = "";
    state.q = "";
    if ($("zoo-search")) $("zoo-search").value = "";
    if (id === "eukarya") {
      state.kingdomName = "Animalia";
      state.kingdomKey = 1;
      state.classId = "mammals";
      state.parentKey = 1;
      state.rank = "species";
      applyClassChipTrail();
    } else {
      var dom = domainMeta();
      state.kingdomName = dom.kingdom || dom.name;
      state.kingdomKey = dom.key;
      state.parentKey = dom.key;
      state.rank = "phylum";
    }
    saveState();
    renderRealms();
    renderDomains();
    renderKingdoms();
    renderCats();
    renderRanks();
    renderCrumb();
    renderLineage();
    if (id === "eukarya") loadList();
    else loadChildren(state.kingdomKey, "kingdom");
  }

  function setKingdom(name, key) {
    state.kingdomName = name;
    state.kingdomKey = key ? parseInt(key, 10) || key : state.kingdomKey;
    state.trail = [];
    state.classId = name === "Animalia" ? "mammals" : "";
    state.parentKey = state.kingdomKey;
    state.rank = name === "Animalia" || name === "Plantae" ? "species" : "phylum";
    if (name === "Animalia") applyClassChipTrail();
    else state.trail = [];
    state.q = "";
    if ($("zoo-search")) $("zoo-search").value = "";
    var krow = (state.kingdoms || []).filter(function (k) {
      return k.name === name;
    })[0];
    if (krow && krow.domain) {
      var d = (state.domains || []).filter(function (x) {
        return x.name === krow.domain;
      })[0];
      if (d) state.domainId = d.id;
    }
    saveState();
    renderRealms();
    renderDomains();
    renderKingdoms();
    renderCats();
    renderRanks();
    renderCrumb();
    renderLineage();
    if (name === "Animalia" || name === "Plantae") loadList();
    else loadChildren(state.kingdomKey, "kingdom");
  }

  function bind() {
    var realms = $("zoo-realms");
    if (realms) {
      realms.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-kingdom]");
        if (!btn) return;
        setKingdom(btn.getAttribute("data-kingdom"), btn.getAttribute("data-key"));
      });
    }
    var domains = $("zoo-domains");
    if (domains) {
      domains.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-domain]");
        if (!btn) return;
        setDomain(btn.getAttribute("data-domain"));
      });
    }
    var kingdoms = $("zoo-kingdoms");
    if (kingdoms) {
      kingdoms.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-kingdom]");
        if (!btn) return;
        setKingdom(btn.getAttribute("data-kingdom"), btn.getAttribute("data-key"));
      });
    }
    var cats = $("zoo-cats");
    if (cats) {
      cats.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-class]");
        if (!btn) return;
        state.classId = btn.getAttribute("data-class") || "";
        state.q = "";
        if ($("zoo-search")) $("zoo-search").value = "";
        var found = (state.classes || []).filter(function (c) {
          return c.id === state.classId;
        })[0];
        state.trail = [];
        if (found) {
          if (found.phylum) {
            state.trail.push({
              rank: "phylum",
              name: found.phylum,
              key: found.phylumKey || null,
            });
          }
          state.trail.push({
            rank: found.rank || "class",
            name: found.name,
            key: found.key,
          });
          state.parentKey = found.key || state.kingdomKey;
          state.rank = "species";
        } else {
          state.parentKey = state.kingdomKey;
          state.rank = "species";
        }
        saveState();
        renderCats();
        renderRanks();
        renderCrumb();
        loadList();
      });
    }
    var ranks = $("zoo-ranks");
    if (ranks) {
      ranks.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-rank]");
        if (!btn) return;
        state.rank = btn.getAttribute("data-rank") || "species";
        renderRanks();
        if (state.rank === "domain") {
          state.list = (state.domains || FALLBACK_DOMAINS).map(function (d) {
            return {
              rank: "domain",
              common: d.name,
              scientific: d.name,
              canonicalName: d.name,
              domain: d.name,
              key: d.key || null,
            };
          });
          renderList();
          setStatus("Three domains of life — only Eukarya has animals, plants, and fungi.");
          return;
        }
        if (state.rank === "kingdom") {
          state.list = kingdomsForDomain().map(function (k) {
            return {
              rank: "kingdom",
              common: k.name,
              scientific: k.name,
              canonicalName: k.name,
              kingdom: k.name,
              domain: k.domain,
              key: k.key,
            };
          });
          renderList();
          setStatus("Kingdoms in " + (domainMeta().name || "this domain"));
          return;
        }
        if (state.rank === "species") {
          loadList();
          return;
        }
        var parent = state.parentKey || classKey() || state.kingdomKey || 1;
        var path = uniquePath();
        var want = RANKS.indexOf(state.rank);
        var i;
        for (i = path.length - 1; i >= 0; i--) {
          var ri = RANKS.indexOf(path[i].rank);
          if (ri >= 0 && ri < want && path[i].key) {
            parent = path[i].key;
            break;
          }
        }
        loadChildren(parent, state.rank);
      });
    }
    var crumb = $("zoo-crumb");
    if (crumb) {
      crumb.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-key]");
        if (!btn) return;
        var key = btn.getAttribute("data-key");
        var rank = btn.getAttribute("data-rank") || "";
        if (rank === "kingdom") {
          var name = (btn.textContent || "").trim();
          setKingdom(name, key);
          return;
        }
        state.parentKey = key;
        var cut = RANKS.indexOf(rank);
        state.trail = (state.trail || []).filter(function (p) {
          var i = RANKS.indexOf(p.rank);
          return i >= 0 && i <= cut;
        });
        state.rank = nextRank(rank);
        renderCrumb();
        renderRanks();
        loadChildren(key, rank);
      });
    }
    var search = $("zoo-search");
    var t = 0;
    if (search) {
      search.addEventListener("input", function () {
        state.q = String(search.value || "").trim();
        clearTimeout(t);
        t = setTimeout(loadList, 280);
      });
    }
    var list = $("zoo-list");
    if (list) {
      list.addEventListener("click", function (ev) {
        var card = ev.target.closest && ev.target.closest(".zoo-card");
        if (!card) return;
        var row = findCard(card.getAttribute("data-id"));
        if (row) selectCreature(row);
      });
      list.addEventListener(
        "error",
        function (ev) {
          if (ev.target && ev.target.tagName === "IMG") ev.target.style.opacity = "0.2";
        },
        true
      );
    }
    var lineage = $("zoo-lineage");
    if (lineage) {
      lineage.addEventListener("change", function (ev) {
        var sel = ev.target && ev.target.closest && ev.target.closest("select[data-rank]");
        if (!sel) return;
        applyLineageRank(sel.getAttribute("data-rank"), sel.value);
      });
      lineage.addEventListener("focusin", function (ev) {
        var sel = ev.target && ev.target.closest && ev.target.closest("select[data-rank]");
        if (!sel) return;
        var rank = sel.getAttribute("data-rank");
        var parent = parentPick(rank);
        if (parent && parent.key) {
          fetchChildren(parent.key).then(function () {
            fillLineageSelects();
          });
        }
      });
    }
    var ring = $("zoo-ring");
    if (ring) {
      ring.addEventListener("click", function (ev) {
        var path = ev.target.closest && ev.target.closest("[data-slot]");
        if (!path) return;
        openBook(parseInt(path.getAttribute("data-slot"), 10));
      });
    }
    var i;
    for (i = 0; i < 3; i++) {
      (function (slot) {
        var well = $("zoo-slot-" + slot);
        if (well) {
          well.addEventListener("click", function () {
            openBook(slot);
          });
        }
      })(i);
    }
    $("zoo-book-close") && $("zoo-book-close").addEventListener("click", closeBook);
    $("zoo-book-prev") &&
      $("zoo-book-prev").addEventListener("click", function () {
        state.bookPage -= 1;
        renderBook();
        preloadSpellNums(pageSlice(state.bookPage));
        saveState();
      });
    $("zoo-book-next") &&
      $("zoo-book-next").addEventListener("click", function () {
        state.bookPage += 1;
        renderBook();
        preloadSpellNums(pageSlice(state.bookPage));
        saveState();
      });
    $("zoo-book-rand") &&
      $("zoo-book-rand").addEventListener("click", function () {
        var list = bookList();
        state.bookPage = Math.floor(Math.random() * Math.max(1, Math.ceil(list.length / BOOK_PAGE)));
        renderBook();
        preloadSpellNums(pageSlice(state.bookPage));
        saveState();
      });
    $("zoo-book-grid") &&
      $("zoo-book-grid").addEventListener("click", function (ev) {
        var tile = ev.target.closest && ev.target.closest("[data-num]");
        if (!tile) return;
        chooseSpell(tile.getAttribute("data-num"));
      });
    $("zoo-random") && $("zoo-random").addEventListener("click", randomAnimal);
    $("zoo-random-stage") && $("zoo-random-stage").addEventListener("click", randomAnimal);
    $("zoo-cast") && $("zoo-cast").addEventListener("click", cast);
    $("zoo-clear-spells") &&
      $("zoo-clear-spells").addEventListener("click", function () {
        state.slots = [null, null, null];
        saveState();
        renderRing();
        setStatus("Spell slots cleared.");
      });
    var aspect = $("zoo-aspect");
    if (aspect) {
      aspect.value = state.aspect || "1:1";
      aspect.addEventListener("change", function () {
        state.aspect = aspect.value || "1:1";
        saveState();
      });
    }
    document.querySelectorAll(".zoo-view-toggle button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.view = btn.getAttribute("data-view") || "stock";
        renderCreature();
      });
    });
  }

  function boot() {
    if (state.ready) {
      loadList();
      armSpells();
      return;
    }
    loadState();
    bind();
    renderLineage();
    renderCreature();
    armSpells();
    fetchJson(apiUrl("/api/zoo/catalog"), 20000)
      .then(function (d) {
        state.classes = (d && d.classes) || [];
        state.featured = (d && d.creatures) || [];
        if (d.domains && d.domains.length) state.domains = d.domains;
        if (d.kingdoms && d.kingdoms.length) state.kingdoms = d.kingdoms;
        if (!state.classId && state.classes[0]) state.classId = state.classes[0].id;
        var found = (state.classes || []).filter(function (c) {
          return c.id === state.classId;
        })[0];
        if (found && !state.trail.length) {
          if (found.phylum) {
            state.trail.push({ rank: "phylum", name: found.phylum, key: found.phylumKey || null });
          }
          state.trail.push({ rank: found.rank || "class", name: found.name, key: found.key });
        }
        renderRealms();
        renderDomains();
        renderKingdoms();
        renderCats();
        renderRanks();
        renderCrumb();
        renderLineage();
        state.ready = true;
        window.dispatchEvent(new Event("zoo-ready"));
        return loadList();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Zoo catalog failed", "error");
        state.ready = true;
      });
  }

  function onShow() {
    boot();
    armSpells();
    renderCreature();
  }

  function onHide() {
    closeBook();
  }

  window.Zoo = { onShow: onShow, onHide: onHide };
  window.addEventListener("zoo-show", onShow);
  window.addEventListener("zoo-hide", onHide);
  window.addEventListener("spellforge-ready", function () {
    state.bookOrder = [];
    armSpells();
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.body.getAttribute("data-active-tab") === "zoo") onShow();
    });
  }
})();
