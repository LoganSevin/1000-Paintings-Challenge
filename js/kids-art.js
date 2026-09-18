/**
 * Kids Art — catalog identities + Spellforge book, same cast/describe/animate loop as Champions.
 * Saves as kids-art/{Id}/{Look}/0.jpg, 1.jpg… not generated/N+1.
 */
(function () {
  "use strict";

  var roster = [];
  var saved = {};
  var selectedId = "";
  var selectedSlug = "Default";
  var selectedVariant = 0;
  var blendSpells = [null, null, null, null, null];
  var spellPage = 0;
  var SPELL_PAGE = 25;
  var armedSlot = -1;
  var spellQuery = "";
  var spellSource = "paintings";
  var SLOT_LABELS = ["I", "II", "III", "IV", "V"];
  var query = "";
  var net = "all";
  var busy = false;
  var busyKind = "";
  var busyStarted = 0;
  var busyTimer = 0;
  var booted = false;
  var portraits = {};
  var portraitQueued = {};
  var portraitQ = [];
  var portraitBusy = 0;
  var portraitObs = null;
  var PORTRAIT_LS = "kidsArtPortraits_v5";
  var PORTRAIT_CONCUR = 10;

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    return path;
  }

  function absUrl(url) {
    if (!url) return "";
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return url;
    }
  }

  function setStatus(msg) {
    var el = $("ka-status");
    if (el) el.textContent = msg || "";
    var ov = $("ka-busy-msg");
    if (ov && busy) ov.textContent = msg || "";
  }

  function setBusy(on, kind, label) {
    busy = !!on;
    busyKind = on ? kind || "" : "";
    ["ka-cast", "ka-describe", "ka-animate"].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !!on;
    });
    var wrap = $("ka-hero-wrap");
    if (wrap) wrap.classList.toggle("busy", !!on);
    var ov = $("ka-busy");
    if (ov) ov.hidden = !on;
    if (busyTimer) {
      clearInterval(busyTimer);
      busyTimer = 0;
    }
    if (on) {
      busyStarted = Date.now();
      if (kind === "video" && $("ka-animate")) $("ka-animate").textContent = "Animating…";
      if (kind === "image" && $("ka-cast")) $("ka-cast").textContent = "Casting…";
      setStatus(label || (kind === "video" ? "Animating…" : "Working…"));
      busyTimer = setInterval(function () {
        var sec = Math.floor((Date.now() - busyStarted) / 1000);
        var mm = String(Math.floor(sec / 60)).padStart(2, "0");
        var ss = String(sec % 60).padStart(2, "0");
        var base = kind === "video" ? "Animating" : kind === "image" ? "Casting" : "Working";
        var line = base + " " + mm + ":" + ss;
        var t = $("ka-busy-time");
        if (t) t.textContent = line;
        if (kind === "video" && $("ka-animate")) $("ka-animate").textContent = line;
      }, 400);
    } else {
      if ($("ka-animate")) $("ka-animate").textContent = "Animate";
      if ($("ka-cast")) $("ka-cast").textContent = "Cast look";
    }
  }

  function byId(id) {
    return roster.filter(function (c) {
      return c.id === id;
    })[0];
  }

  function skinsOf(c) {
    var rec = saved[c && c.id] || {};
    return (rec.skins || []).slice();
  }

  function skinBySlug(c, slug) {
    return skinsOf(c).filter(function (s) {
      return String(s.slug || s.folder || "") === String(slug);
    })[0];
  }

  function intIndex(n) {
    var v = parseInt(n, 10);
    return isNaN(v) ? 0 : v;
  }

  function variantUrl(c, slug, variant) {
    var s = skinBySlug(c, slug);
    if (!s) return "";
    variant = variant == null ? 0 : intIndex(variant);
    var folder = s.folder || s.slug;
    var file =
      variant === 0 && s.file
        ? s.file
        : "/kids-art/" + c.id + "/" + folder + "/" + variant + ".jpg";
    return file
      .split("/")
      .map(function (seg, i) {
        if (i === 0 && seg === "") return "";
        return encodeURIComponent(seg);
      })
      .join("/");
  }

  function catalog() {
    if (window.KidsCatalog && window.KidsCatalog.all) return window.KidsCatalog.all() || [];
    return [];
  }

  function mergeRoster() {
    roster = catalog().map(function (c) {
      var rec = saved[c.id] || {};
      return Object.assign({}, c, {
        skins: rec.skins || [],
        animations: rec.animations || [],
        look: rec.look || null,
        skin_count: (rec.skins || []).length,
      });
    });
  }

  function loadPortraitCache() {
    try {
      var raw = JSON.parse(localStorage.getItem(PORTRAIT_LS) || "{}");
      if (raw && typeof raw === "object") portraits = raw;
    } catch (e) {}
    return fetch(apiUrl("/api/kids-art/portraits"), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var map = (d && d.portraits) || {};
        Object.keys(map).forEach(function (id) {
          if (id === "_v") return;
          var rec = map[id];
          var file = rec && (rec.file || rec.url);
          if (file && !badPortrait(file, "", id)) portraits[id] = file;
        });
        savePortraitCache();
      })
      .catch(function () {});
  }

  function savePortraitCache() {
    try {
      var out = {};
      Object.keys(portraits).forEach(function (id) {
        if (portraits[id]) out[id] = portraits[id];
      });
      localStorage.setItem(PORTRAIT_LS, JSON.stringify(out));
    } catch (e) {}
  }

  var WD_HUMAN = { Q5: 1, Q215627: 1 };
  var WD_FICTION = {
    Q95074: 1,
    Q15711870: 1,
    Q15632617: 1,
    Q4271324: 1,
    Q15275719: 1,
    Q15773347: 1,
    Q3658341: 1,
    Q1128623: 1,
    Q502895: 1,
  };
  var WD_SHOW = {
    Q5398426: 1,
    Q15416: 1,
    Q11424: 1,
    Q18011172: 1,
    Q202473: 1,
    Q581714: 1,
    Q2431196: 1,
    Q1259759: 1,
    Q117467246: 1,
    Q1297900: 1,
  };
  var PORTRAIT_STOP = {
    the: 1, and: 1, for: 1, with: 1, from: 1, show: 1, series: 1, cartoon: 1,
    character: 1, animated: 1, television: 1, disney: 1, nick: 1, network: 1,
    official: 1, preserved: 1, kids: 1, baby: 1, his: 1, her: 1, that: 1, this: 1,
  };

  function cleanShow(s) {
    return String(s || "")
      .replace(/Preserved:\s*/i, "")
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .trim();
  }

  function portraitQuery(c) {
    var show = cleanShow(c && c.show);
    var name = String((c && c.name) || "").trim();
    if (show && show.length < 70) return (name + " " + show).trim();
    return (name + " cartoon character").trim();
  }

  function words(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function subjectTokens(c) {
    var name = words(c && c.name).filter(function (w) {
      return w.length >= 2 && !PORTRAIT_STOP[w];
    });
    var show = words(cleanShow(c && c.show)).filter(function (w) {
      return w.length >= 3 && !PORTRAIT_STOP[w];
    });
    return { name: name, show: show };
  }

  function matchesSubject(c, title, desc) {
    var hay = words(title + " " + desc).join(" ");
    var t = subjectTokens(c);
    if (!t.name.length) return false;
    var nameHits = t.name.filter(function (w) {
      return hay.indexOf(w) >= 0;
    });
    if (nameHits.length < t.name.length) return false;
    if (t.name.length === 1 && t.name[0].length <= 8 && t.show.length) {
      return t.show.some(function (w) {
        return hay.indexOf(w) >= 0;
      });
    }
    return true;
  }

  function badPortrait(url, desc, title) {
    var u = String(url || "").toLowerCase();
    var lead = (String(title || "") + " " + String(desc || "")).toLowerCase();
    if (/logo|wordmark|logotype|word_mark|title.?card|titlecard/.test(u)) return true;
    if (/\b(official logo|film poster|theatrical poster|album cover)\b/.test(lead)) return true;
    var person = /\b(actor|actress|singer|rapper|musician|voice actor|television presenter|youtuber|comedian|film director|politician|puppeteer)\b/.test(lead);
    var cartoon = /\b(fictional character|muppet|cartoon character|animated character|mascot|nicktoon|disney character)\b/.test(lead);
    if (person && !cartoon) return true;
    return false;
  }

  function wdSearch(q) {
    return fetch(
      "https://www.wikidata.org/w/api.php?origin=*&action=wbsearchentities&format=json&language=en&uselang=en&type=item&limit=8&search=" +
        encodeURIComponent(q)
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        return (d && d.search) || [];
      })
      .catch(function () {
        return [];
      });
  }

  function wdGet(ids) {
    var list = (ids || []).filter(Boolean).slice(0, 20);
    if (!list.length) return Promise.resolve({});
    return fetch(
      "https://www.wikidata.org/w/api.php?origin=*&action=wbgetentities&format=json&languages=en&props=claims|labels|descriptions&ids=" +
        list.join("|")
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        return (d && d.entities) || {};
      })
      .catch(function () {
        return {};
      });
  }

  function wdClaimIds(ent, prop) {
    return ((ent && ent.claims && ent.claims[prop]) || [])
      .map(function (row) {
        var v = row && row.mainsnak && row.mainsnak.datavalue && row.mainsnak.datavalue.value;
        return v && v.id;
      })
      .filter(Boolean);
  }

  function wdClaimFile(ent, prop) {
    var row = ((ent && ent.claims && ent.claims[prop]) || [])[0];
    var v = row && row.mainsnak && row.mainsnak.datavalue && row.mainsnak.datavalue.value;
    return typeof v === "string" ? v : "";
  }

  function commonsFile(name) {
    if (!name || badPortrait(name, "", name)) return "";
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(name) + "?width=400";
  }

  function wdKind(ent, desc) {
    var types = wdClaimIds(ent, "P31");
    var human = types.some(function (id) {
      return WD_HUMAN[id];
    });
    var fiction = types.some(function (id) {
      return WD_FICTION[id];
    });
    var show = types.some(function (id) {
      return WD_SHOW[id];
    });
    if (human && !fiction) return "human";
    if (fiction) return "character";
    if (show) return "show";
    var d = String(desc || "").toLowerCase();
    if (/\b(actor|actress|singer|rapper|politician)\b/.test(d) && !/fictional|animated|cartoon|character/.test(d)) return "human";
    if (/animated|cartoon|fictional character/.test(d)) return "show";
    return "other";
  }

  function pickWikiPage(p, c) {
    if (!p || p.missing != null) return "";
    var src = (p.thumbnail && p.thumbnail.source) || "";
    var lead = p.description || "";
    var extract = p.extract || "";
    if (!src) return "";
    if (/\b(book|novel|kindle|isbn|hardcover|paperback)\b/i.test(p.title || "")) return "";
    if (badPortrait(src, lead, p.title)) return "";
    if (!matchesSubject(c, p.title, lead + " " + extract)) return "";
    return src;
  }

  function wikiTitlesImage(titles, c) {
    var list = (titles || []).filter(Boolean).slice(0, 8);
    if (!list.length) return Promise.resolve("");
    var u =
      "https://en.wikipedia.org/w/api.php?origin=*&action=query&format=json&redirects=1&prop=pageimages|description|extracts&exintro=1&explaintext=1&exchars=180&piprop=thumbnail&pithumbsize=400&pilicense=any&titles=" +
      list
        .map(function (t) {
          return encodeURIComponent(t);
        })
        .join("|");
    return fetch(u)
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var pages = (d && d.query && d.query.pages) || {};
        var keys = Object.keys(pages);
        var i;
        for (i = 0; i < keys.length; i++) {
          var src = pickWikiPage(pages[keys[i]], c);
          if (src) return src;
        }
        return "";
      })
      .catch(function () {
        return "";
      });
  }

  function wikiSummary(title, c) {
    return wikiTitlesImage([title], c);
  }

  function wikiSearchBest(query, c) {
    var u =
      "https://en.wikipedia.org/w/api.php?origin=*&action=query&format=json&generator=search&gsrlimit=8&redirects=1&prop=pageimages|description|extracts&exintro=1&explaintext=1&exchars=220&piprop=thumbnail&pithumbsize=400&pilicense=any&gsrsearch=" +
      encodeURIComponent(query);
    return fetch(u)
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var pages = Object.keys((d && d.query && d.query.pages) || {}).map(function (k) {
          return d.query.pages[k];
        });
        pages.sort(function (a, b) {
          return (a.index || 99) - (b.index || 99);
        });
        var i;
        for (i = 0; i < pages.length; i++) {
          var src = pickWikiPage(pages[i], c);
          if (src) return src;
        }
        return "";
      })
      .catch(function () {
        return "";
      });
  }

  function commonsSearch(c) {
    var name = String((c && c.name) || "").trim();
    var show = cleanShow(c && c.show);
    var q = (name + " " + show + " cartoon").trim();
    var u =
      "https://commons.wikimedia.org/w/api.php?origin=*&action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=" +
      encodeURIComponent(q) +
      "&prop=imageinfo&iiprop=url|mime&iiurlwidth=400";
    return fetch(u)
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var pages = Object.keys((d && d.query && d.query.pages) || {}).map(function (k) {
          return d.query.pages[k];
        });
        var i;
        for (i = 0; i < pages.length; i++) {
          var p = pages[i] || {};
          var info = (p.imageinfo && p.imageinfo[0]) || {};
          var src = info.thumburl || info.url || "";
          var title = p.title || "";
          if (!src) continue;
          if (badPortrait(src, "", title)) continue;
          if (!matchesSubject(c, title, q)) continue;
          return src;
        }
        return "";
      })
      .catch(function () {
        return "";
      });
  }

  var WIKI_TITLES = {
    Elmo: ["Elmo"],
    BigBird: ["Big Bird"],
    CookieMonster: ["Cookie Monster"],
    Grover: ["Grover"],
    OscartheGrouch: ["Oscar the Grouch"],
    Bert: ["Bert (Sesame Street)"],
    Ernie: ["Ernie (Sesame Street)"],
    CountvonCount: ["Count von Count"],
    AbbyCadabby: ["Abby Cadabby"],
    PrairieDawn: ["Prairie Dawn"],
    BabyBear: ["Baby Bear (Sesame Street)"],
    Snuffy: ["Mr. Snuffleupagus"],
    Karli: ["Karli (Sesame Street)"],
    Gonger: ["Gonger"],
    PeppaPig: ["Peppa Pig"],
    GeorgePig: ["George Pig"],
    Bluey: ["Bluey (2018 TV series)", "Bluey Heeler"],
    BingoHeeler: ["Bingo Heeler"],
    BanditHeeler: ["Bandit Heeler"],
    ChilliHeeler: ["Chilli Heeler"],
    Blippi: ["Blippi"],
    MsRachel: ["Ms. Rachel"],
    SuperSimpleSongs: ["Super Simple Songs"],
    LittleBabyBum: ["Little Baby Bum"],
    Cocomelon: ["Cocomelon"],
    Chase: ["Chase (Paw Patrol)"],
    Marshall: ["Marshall (Paw Patrol)"],
    Skye: ["Skye (Paw Patrol)"],
    Rubble: ["Rubble (Paw Patrol)"],
    Rocky: ["Rocky (Paw Patrol)"],
    Zuma: ["Zuma (Paw Patrol)"],
    Everest: ["Everest (Paw Patrol)"],
    Ryder: ["Ryder (Paw Patrol)"],
    Boots: ["Boots (Dora the Explorer)"],
    Swiper: ["Swiper (Dora the Explorer)"],
    Molly: ["Molly (Bubble Guppies)"],
    Gil: ["Gil (Bubble Guppies)"],
    Catboy: ["Catboy"],
    Owlette: ["Owlette"],
    Gekko: ["Gekko (PJ Masks)"],
    DannyPhantom: ["Danny Phantom"],
    DannyFenton: ["Danny Fenton"],
  };

  function allowPersonPhoto(c) {
    var n = ((c && c.name) || "") + " " + ((c && c.show) || "");
    return /blippi|ms\.?\s*rachel|wiggles|sportacus|lazy town/i.test(n);
  }

  var tvmazeCache = {};
  var tvmazeInflight = {};
  var tvmazeBusy = 0;
  var tvmazeWaiters = [];

  function tvQuery(c) {
    var name = String((c && c.name) || "").trim();
    var show = cleanShow(c && c.show);
    if (/sesame street|paw patrol|peppa pig|bluey|dora|bubble guppies|daniel tiger|doc mcstuffins|pj masks|octonauts|little einsteins|team umizoomi|wonder pets|gabby|blue'?s clues|cocomelon|blippi|ms\.?\s*rachel|super simple|little baby bum|wiggles|barney|teletubbies|spongebob|fairly odd|danny phantom|avatar|phineas|gravity falls|amphibia|owl house/i.test(name)) {
      return name.replace(/\s*\(.*$/, "").trim();
    }
    if (show && show.length > 3 && show.length < 70 && !/^(muppets|family|songs|feelings|adventure|rescue|pups|animals|school|math|toys|cats|ghosts|babies)$/i.test(show)) {
      return show;
    }
    return name;
  }

  function tvmazeShow(q) {
    var key = String(q || "").toLowerCase();
    if (!key) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(tvmazeCache, key)) return Promise.resolve(tvmazeCache[key]);
    if (tvmazeInflight[key]) return tvmazeInflight[key];
    var p = new Promise(function (resolve) {
      function run() {
        tvmazeBusy += 1;
        fetch("https://api.tvmaze.com/singlesearch/shows?q=" + encodeURIComponent(q) + "&embed=cast")
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (d) {
            if (!d) {
              tvmazeCache[key] = null;
              resolve(null);
              return;
            }
            var rec = {
              id: d.id,
              name: d.name,
              image: (d.image && (d.image.original || d.image.medium)) || "",
              cast: ((d._embedded && d._embedded.cast) || []).map(function (row) {
                var ch = row.character || {};
                var pe = row.person || {};
                return {
                  character: ch.name || "",
                  characterImage: (ch.image && (ch.image.original || ch.image.medium)) || "",
                  person: pe.name || "",
                  personImage: (pe.image && (pe.image.original || pe.image.medium)) || "",
                };
              }),
            };
            tvmazeCache[key] = rec;
            resolve(rec);
          })
          .catch(function () {
            tvmazeCache[key] = null;
            resolve(null);
          })
          .then(function () {
            tvmazeBusy -= 1;
            delete tvmazeInflight[key];
            var next = tvmazeWaiters.shift();
            if (next) next();
          });
      }
      if (tvmazeBusy < 3) run();
      else tvmazeWaiters.push(run);
    });
    tvmazeInflight[key] = p;
    return p;
  }

  function namesClose(a, b) {
    a = String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    b = String(b || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
    var aw = a.split(" ").filter(function (w) { return w.length > 2; });
    var bw = b.split(" ").filter(function (w) { return w.length > 2; });
    if (!aw.length || !bw.length) return a === b;
    return aw.every(function (w) { return b.indexOf(w) >= 0; }) || bw.every(function (w) { return a.indexOf(w) >= 0; });
  }

  function tvmazeArt(c) {
    var q = tvQuery(c);
    return tvmazeShow(q).then(function (rec) {
      if (!rec) return "";
      var i;
      var name = c.name;
      for (i = 0; i < rec.cast.length; i++) {
        var row = rec.cast[i];
        if (!namesClose(row.character, name)) continue;
        if (row.characterImage) return row.characterImage;
        if (allowPersonPhoto(c) && row.personImage) return row.personImage;
      }
      if (namesClose(rec.name, name) && rec.image) return rec.image;
      return "";
    });
  }

  function itunesArt(c) {
    var term = (c.name + " " + (cleanShow(c.show) || "")).trim();
    var endpoints = [
      "https://itunes.apple.com/search?limit=6&media=tvShow&term=" + encodeURIComponent(term),
      "https://itunes.apple.com/search?limit=6&entity=album&term=" + encodeURIComponent(term),
    ];
    function one(url) {
      return fetch(url)
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          var results = (d && d.results) || [];
          var i;
          for (i = 0; i < results.length; i++) {
            var item = results[i] || {};
            var blob = ((item.trackName || "") + " " + (item.collectionName || "") + " " + (item.artistName || "")).toLowerCase();
            if (/\b(kindle|audiobook|hardcover|paperback|colouring book|coloring book)\b/.test(blob)) continue;
            if (!matchesSubject(c, item.collectionName || item.trackName || "", item.artistName || "")) continue;
            var art = item.artworkUrl100 || item.artworkUrl60 || "";
            if (!art) continue;
            return art.replace(/100x100bb/, "400x400bb").replace(/60x60bb/, "400x400bb");
          }
          return "";
        })
        .catch(function () {
          return "";
        });
    }
    return one(endpoints[0]).then(function (url) {
      return url || one(endpoints[1]);
    });
  }

  function wikiFallback(c) {
    var name = String((c && c.name) || "").trim();
    var show = cleanShow(c && c.show);
    var titles = [name];
    if (show) {
      titles.push(name + " (" + show + ")");
      titles.push(name + " (" + show + " character)");
    }
    titles.push(name + " (character)");
    titles.push(name + " (TV series)");
    return wikiTitlesImage(titles, c)
      .then(function (url) {
        if (url) return url;
        return wikiSearchBest('"' + name + '" ' + (show || "cartoon character"), c);
      })
      .then(function (url) {
        if (url) return url;
        return wikiSearchBest(name + " " + (show || "cartoon"), c);
      })
      .then(function (url) {
        return url || commonsSearch(c);
      });
  }

  function applyPortrait(id, url) {
    if (!id || !url) return;
    portraits[id] = url;
    savePortraitCache();
    document.querySelectorAll('.ka-card[data-id="' + id + '"] .ka-card-av').forEach(function (av) {
      var img = av.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        av.textContent = "";
        av.appendChild(img);
      }
      if (img.getAttribute("data-stock") !== "studio") img.src = url;
    });
    if (selectedId === id) {
      var hero = $("ka-hero");
      var fallback = $("ka-hero-fallback");
      var c = byId(id);
      if (c && !skinsOf(c).length && hero) {
        hero.src = url;
        hero.hidden = false;
        if (fallback) fallback.hidden = true;
      }
    }
  }

  var cameoIds = {};
  var cameoExpanded = {};

  function pickCameoImage(ent) {
    var label = (((ent && ent.labels) || {}).en || {}).value || "";
    var desc = (((ent && ent.descriptions) || {}).en || {}).value || "";
    if (!label) return "";
    if (wdKind(ent, desc) === "human") return "";
    var url = commonsFile(wdClaimFile(ent, "P18"));
    if (url && badPortrait(url, desc, label)) url = "";
    return { label: label, desc: desc, url: url, ent: ent };
  }

  function injectCameos(parent, ents) {
    if (!parent || !ents || cameoExpanded[parent.id]) return;
    cameoExpanded[parent.id] = true;
    var extra = [];
    Object.keys(ents).forEach(function (qid) {
      var picked = pickCameoImage(ents[qid]);
      if (!picked || !picked.label) return;
      var idFn = window.KidsCatalog && window.KidsCatalog.id;
      var cid = idFn ? idFn(picked.label) : String(picked.label).replace(/[^A-Za-z0-9]+/g, "") || "Cameo";
      if (cid === parent.id || byId(cid) || cameoIds[cid]) return;
      cameoIds[cid] = true;
      extra.push({
        id: cid,
        name: picked.label,
        show: parent.name,
        blurb: picked.desc || ("Cast of " + parent.name),
        hue: parent.hue,
        emoji: parent.emoji,
        net: parent.net,
        shelf: parent.name + " cameos",
        cameo: true,
        skins: [],
        animations: [],
        skin_count: 0,
      });
      if (picked.url) portraits[cid] = picked.url;
    });
    if (!extra.length) return;
    roster = roster.concat(extra);
    renderGrid();
  }

  function pickWdImage(ent, c) {
    var label = (((ent.labels || {}).en || {}).value) || "";
    var desc = (((ent.descriptions || {}).en || {}).value) || "";
    if (!matchesSubject(c, label, desc)) return "";
    var kind = wdKind(ent, desc);
    if (kind === "human") return "";
    var url = commonsFile(wdClaimFile(ent, "P18"));
    if (url && badPortrait(url, desc, label)) url = "";
    return { kind: kind, url: url, ent: ent, label: label, desc: desc };
  }

  function resolvePortrait(c) {
    var mapped = WIKI_TITLES[c.id] || [];
    return tvmazeArt(c)
      .then(function (url) {
        return url || itunesArt(c);
      })
      .then(function (url) {
        if (url) return url;
        var titles = mapped.slice();
        titles.push(c.name);
        if (c.show) titles.push(c.name + " (" + cleanShow(c.show) + ")");
        titles.push(c.name + " (character)");
        return wikiTitlesImage(titles, c);
      })
      .then(function (url) {
        return url || wikiFallback(c);
      })
      .then(function (url) {
        if (url) {
          fetch(
            apiUrl(
              "/api/kids-art/portrait?id=" +
                encodeURIComponent(c.id) +
                "&name=" +
                encodeURIComponent(c.name || "") +
                "&show=" +
                encodeURIComponent(cleanShow(c.show)) +
                "&url=" +
                encodeURIComponent(url)
            )
          ).catch(function () {});
        }
        return url;
      });
  }

  function pumpPortraits() {
    while (portraitBusy < PORTRAIT_CONCUR && portraitQ.length) {
      var c = portraitQ.shift();
      if (!c || portraits[c.id] !== undefined) continue;
      portraitBusy += 1;
      if ($("ka-status")) $("ka-status").textContent = "Loading pictures · " + portraitQ.length + " left";
      resolvePortrait(c)
        .then(function (url) {
          if (url) applyPortrait(c.id, url);
          else portraits[c.id] = "";
          if (!portraitQ.length && $("ka-status")) $("ka-status").textContent = roster.length + " catalog characters";
        })
        .finally(function () {
          portraitBusy -= 1;
          pumpPortraits();
        });
    }
  }

  function queuePortrait(c) {
    if (!c || !c.id) return;
    if (portraits[c.id] !== undefined || portraitQueued[c.id]) return;
    portraitQueued[c.id] = true;
    portraitQ.push(c);
    pumpPortraits();
  }

  function observePortrait(card, c) {
    if (!portraitObs) {
      portraitObs = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            var id = en.target.getAttribute("data-id");
            var ch = byId(id);
            if (ch) queuePortrait(ch);
            portraitObs.unobserve(en.target);
          });
        },
        { root: null, rootMargin: "400px" }
      );
    }
    portraitObs.observe(card);
  }

  function stockUrl(c) {
    if (c.skins && c.skins[0] && c.skins[0].file) return c.skins[0].file;
    var u = portraits[c.id] || "";
    if (u && badPortrait(u, "", c.name)) return "";
    return u;
  }

  function filtered() {
    var q = String(query || "").trim().toLowerCase();
    return roster.filter(function (c) {
      if (net !== "all" && c.net !== net) return false;
      if (net === "toonami" || net === "adultswim") {
        if (!(window.KidsLock && window.KidsLock.moreUnlocked && window.KidsLock.moreUnlocked())) return false;
      }
      if (!q) return true;
      return (c.name + " " + c.show + " " + c.shelf + " " + c.blurb).toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderGrid() {
    var hold = $("ka-grid");
    if (!hold) return;
    var list = filtered();
    if ($("ka-count")) $("ka-count").textContent = list.length + " characters";
    hold.innerHTML = "";
    list.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.id = c.id;
      b.className = "ka-card" + (c.id === selectedId ? " selected" : "") + (c.skin_count ? " has-skin" : "");
      b.style.setProperty("--h", String(c.hue || 280));
      var av = document.createElement("div");
      av.className = "ka-card-av";
      var still = stockUrl(c);
      if (still) {
        var img = document.createElement("img");
        img.alt = c.name;
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.src = still;
        if (c.skins && c.skins[0] && c.skins[0].file) img.setAttribute("data-stock", "studio");
        av.appendChild(img);
      } else {
        av.textContent = c.emoji || "★";
      }
      var name = document.createElement("span");
      name.className = "ka-card-name";
      name.textContent = c.name;
      var sub = document.createElement("span");
      sub.className = "ka-card-skins";
      sub.textContent = (c.skin_count ? c.skin_count + " looks · " : "") + (c.show || c.shelf || "");
      b.appendChild(av);
      b.appendChild(name);
      b.appendChild(sub);
      b.addEventListener("click", function () {
        selectChar(c.id);
      });
      hold.appendChild(b);
      if (!still) observePortrait(b, c);
    });
    list.forEach(function (c) {
      if (!stockUrl(c)) queuePortrait(c);
    });
  }

  function renderSkinStrip(c) {
    var hold = $("ka-skins");
    if (!hold) return;
    hold.innerHTML = "";
    var skins = skinsOf(c);
    if (!skins.length) {
      hold.textContent = "No studio looks yet — pick 5 spells and Cast.";
      return;
    }
    skins.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ka-skin" + (s.slug === selectedSlug ? " selected" : "");
      var img = document.createElement("img");
      img.alt = "";
      img.src = s.file || variantUrl(c, s.slug, 0);
      var lab = document.createElement("span");
      lab.className = "ka-skin-name";
      lab.textContent = s.name || s.slug;
      if ((s.variant_count || 1) > 0) {
        var badge = document.createElement("span");
        badge.className = "ka-var-badge";
        badge.textContent = String(s.variant_count || 1);
        b.appendChild(badge);
      }
      b.appendChild(img);
      b.appendChild(lab);
      b.addEventListener("click", function () {
        selectedSlug = s.slug;
        selectedVariant = 0;
        selectChar(c.id, true);
      });
      hold.appendChild(b);
    });
  }

  function renderVariants(c) {
    var hold = $("ka-variants");
    if (!hold) return;
    hold.innerHTML = "";
    var s = skinBySlug(c, selectedSlug);
    var count = s ? intIndex(s.variant_count) : 0;
    var i;
    for (i = 0; i < count; i++) {
      (function (v) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "ka-skin" + (v === selectedVariant ? " selected" : "");
        var img = document.createElement("img");
        img.alt = String(v);
        img.src = variantUrl(c, selectedSlug, v);
        var lab = document.createElement("span");
        lab.className = "ka-skin-name";
        lab.textContent = String(v) + ".jpg";
        b.appendChild(img);
        b.appendChild(lab);
        b.addEventListener("click", function () {
          selectedVariant = v;
          selectChar(c.id, true);
        });
        hold.appendChild(b);
      })(i);
    }
  }

  function renderAnims(c) {
    var hold = $("ka-anims");
    if (!hold) return;
    hold.innerHTML = "";
    ((c && c.animations) || []).forEach(function (a) {
      var link = document.createElement("a");
      link.href = a.file;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = (a.action || "clip") + " " + (a.index || 0);
      hold.appendChild(link);
    });
  }

  function selectChar(id, keepSkin) {
    var c = byId(id);
    if (!c) return;
    selectedId = id;
    if (!keepSkin) {
      var skins = skinsOf(c);
      selectedSlug = (skins[0] && skins[0].slug) || "Default";
      selectedVariant = 0;
    }
    var skinRow = skinBySlug(c, selectedSlug);
    $("ka-name").textContent = c.name;
    $("ka-title").textContent = (c.show || "") + (c.shelf ? " · " + c.shelf : "");
    $("ka-idline").textContent = c.id + " · original studio catalog card";
    var hero = $("ka-hero");
    var fallback = $("ka-hero-fallback");
    var url = variantUrl(c, selectedSlug, selectedVariant) || portraits[c.id] || "";
    if (hero) {
      if (url) {
        hero.src = url;
        hero.hidden = false;
        if (fallback) fallback.hidden = true;
      } else {
        hero.removeAttribute("src");
        hero.hidden = true;
        if (fallback) {
          fallback.hidden = false;
          fallback.style.setProperty("--h", String(c.hue || 280));
          fallback.textContent = c.emoji || "★";
        }
        queuePortrait(c);
      }
    }
    var look = (skinRow && skinRow.look) || c.look || {};
    if ($("ka-desc")) $("ka-desc").textContent = look.description || "";
    if ($("ka-prompt")) $("ka-prompt").value = look.prompt || "";
    if ($("ka-site")) {
      $("ka-site").textContent =
        c.name +
        (c.show ? ", " + c.show : "") +
        ". " +
        (c.blurb || "") +
        " Original Spellforge fusion — not an official still.";
    }
    renderSkinStrip(c);
    renderVariants(c);
    renderAnims(c);
    renderGrid();
  }

  function loadSaved() {
    return fetch(apiUrl("/api/kids-art"), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        saved = (d && d.index) || {};
        mergeRoster();
        renderGrid();
        if (selectedId && byId(selectedId)) selectChar(selectedId, true);
        setStatus(roster.length + " catalog characters");
      })
      .catch(function () {
        mergeRoster();
        renderGrid();
        setStatus(roster.length + " catalog characters · save API offline");
      });
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    return absUrl(
      (img && (img.url || img.download_url || img.uri)) || payload.image_url || payload.output_url || ""
    );
  }

  function extractVideoUrl(payload) {
    if (!payload) return "";
    var v = payload.video || payload.clip || (payload.videos && payload.videos[0]);
    return absUrl(
      (v && (v.url || v.download_url)) || payload.video_url || payload.output_url || payload.url || ""
    );
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function pollJob(jobId, kind, left) {
    if (left == null) left = 90;
    if (left <= 0) return Promise.reject(new Error("Timed out"));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        if (!res.ok && res.status === 404) {
          return delay(1200).then(function () {
            return pollJob(jobId, kind, left - 1);
          });
        }
        var st = String(job.status || job.xai_status || "working").toLowerCase();
        setStatus((kind === "video" ? "Animating" : "Casting") + "… " + st);
        if (st === "done" || st === "completed" || st === "success" || st === "succeeded") {
          var url = kind === "video" ? extractVideoUrl(job) : extractImageUrl(job);
          if (url) return url;
          throw new Error("Job finished with no file.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Job failed");
        }
        return delay(1500).then(function () {
          return pollJob(jobId, kind, left - 1);
        });
      });
  }

  function paintingUrl(n) {
    n = parseInt(n, 10);
    if (!n) return "";
    if (typeof window.getSpellforgeSpellUrl === "function") {
      var u = window.getSpellforgeSpellUrl(n);
      if (u) return u;
    }
    if (n >= 100000 && n < 200000) return "generated/" + (n - 100000) + ".jpg";
    if (n >= 200000 && n < 300000) return "sketches/" + (n - 200000) + ".png";
    if (n >= 300000 && n < 400000) return "sketches-inverted/" + (n - 300000) + ".png";
    if (typeof window.getPaintingUrl === "function") return window.getPaintingUrl(n);
    return "paintings/" + n + ".jpg";
  }

  function displayOrder() {
    var pool = [];
    try {
      if (window.SpellforgeAPI && window.SpellforgeAPI.getDisplayOrder) {
        pool = window.SpellforgeAPI.getDisplayOrder() || [];
      }
    } catch (e) {}
    if (!pool.length) {
      try {
        pool = JSON.parse(localStorage.getItem("spellforge_display_order_v11") || "[]");
      } catch (e2) {
        pool = [];
      }
    }
    var seen = {};
    var out = [];
    (pool || []).forEach(function (n) {
      n = parseInt(n, 10);
      if (!n || seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    return out;
  }

  function arsenalBreakdown() {
    var order = displayOrder();
    var paintings = 0;
    var generated = 0;
    order.forEach(function (n) {
      if (n >= 1 && n <= 1000) paintings += 1;
      else if (n >= 100000 && n < 200000) generated += 1;
    });
    return { paintings: paintings, generated: generated, total: order.length };
  }

  function bookCountNote() {
    var b = arsenalBreakdown();
    if (spellSource === "paintings") return "";
    if (spellSource === "generated") return " · generated extras";
    return " · " + b.paintings + " paintings + " + b.generated + " generated";
  }

  function updateSourceLabels() {
    var sel = $("ka-spell-source");
    if (!sel) return;
    var b = arsenalBreakdown();
    var i;
    for (i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === "paintings") sel.options[i].textContent = "Paintings · " + b.paintings;
      else if (sel.options[i].value === "generated") sel.options[i].textContent = "Generated · " + b.generated;
      else if (sel.options[i].value === "all") sel.options[i].textContent = "All arsenal · " + b.total;
    }
  }

  function bookList() {
    var order = displayOrder();
    if (spellSource === "paintings") {
      order = order.filter(function (n) {
        return n >= 1 && n <= 1000;
      });
    } else if (spellSource === "generated") {
      order = order.filter(function (n) {
        return n >= 100000;
      });
    }
    var q = String(spellQuery || "").trim().toLowerCase();
    if (!q) return order;
    return order.filter(function (n) {
      return String(n).indexOf(q) >= 0;
    });
  }

  function fillBlendFromEquipped() {
    var slots = [];
    try {
      if (window.SpellforgeAPI && window.SpellforgeAPI.getEquippedSlots) {
        slots = window.SpellforgeAPI.getEquippedSlots() || [];
      }
    } catch (e) {}
    var i;
    for (i = 0; i < 5; i++) {
      var n = parseInt(slots[i], 10);
      if (n > 0 && n < 400000) blendSpells[i] = n;
    }
  }

  function renderSpellSlots() {
    var hold = $("ka-spell-slots");
    if (!hold) return;
    hold.innerHTML = "";
    blendSpells.forEach(function (n, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ka-spell-slot" + (armedSlot === i ? " armed" : "");
      var lab = document.createElement("span");
      lab.className = "slot-label";
      lab.textContent = "Spell " + SLOT_LABELS[i];
      b.appendChild(lab);
      if (n) {
        var img = document.createElement("img");
        img.alt = "#" + n;
        img.src = paintingUrl(n);
        b.appendChild(img);
      }
      b.addEventListener("click", function () {
        if (armedSlot === i && blendSpells[i]) {
          blendSpells[i] = null;
          armedSlot = i;
        } else {
          armedSlot = i;
        }
        renderSpellSlots();
        renderSpellTray();
      });
      hold.appendChild(b);
    });
  }

  function placeSpell(n) {
    n = parseInt(n, 10);
    if (!(n > 0)) return;
    var target = armedSlot;
    if (target < 0 || target > 4) {
      target = blendSpells.indexOf(null);
      if (target < 0) target = 0;
    }
    var prev = blendSpells.indexOf(n);
    if (prev >= 0 && prev !== target) blendSpells[prev] = null;
    blendSpells[target] = n;
    armedSlot = (target + 1) % 5;
    renderSpellSlots();
    renderSpellTray();
  }

  function renderSpellTray() {
    var hold = $("ka-spell-tray");
    if (!hold) return;
    var order = bookList();
    var pages = Math.max(1, Math.ceil(order.length / SPELL_PAGE));
    if (spellPage >= pages) spellPage = pages - 1;
    if (spellPage < 0) spellPage = 0;
    if ($("ka-spell-prev")) $("ka-spell-prev").disabled = spellPage <= 0;
    if ($("ka-spell-next")) $("ka-spell-next").disabled = spellPage >= pages - 1;
    if ($("ka-spell-page")) {
      $("ka-spell-page").textContent =
        "Page " + (spellPage + 1) + " / " + pages + " · " + order.length + " spells" + bookCountNote();
    }
    updateSourceLabels();
    var jump = $("ka-spell-page-jump");
    if (jump && document.activeElement !== jump) jump.value = String(spellPage + 1);
    var slice = order.slice(spellPage * SPELL_PAGE, spellPage * SPELL_PAGE + SPELL_PAGE);
    hold.innerHTML = "";
    if (!order.length) {
      var empty = document.createElement("p");
      empty.className = "ka-hint";
      empty.textContent = "Loading your Spellforge book…";
      hold.appendChild(empty);
      return;
    }
    slice.forEach(function (n) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = blendSpells.indexOf(n) >= 0 ? "picked" : "";
      b.title = "Spell #" + n;
      var img = document.createElement("img");
      img.alt = "#" + n;
      img.loading = "lazy";
      img.decoding = "async";
      img.src = paintingUrl(n);
      img.onerror = function () {
        img.style.opacity = "0.15";
        img.onerror = null;
      };
      b.appendChild(img);
      var num = document.createElement("span");
      num.className = "ka-num";
      num.textContent = "#" + n;
      b.appendChild(num);
      b.addEventListener("click", function () {
        placeSpell(n);
      });
      hold.appendChild(b);
    });
  }

  function bootBook() {
    fillBlendFromEquipped();
    renderSpellSlots();
    renderSpellTray();
  }

  function castLook() {
    var c = byId(selectedId);
    if (!c || busy) return;
    var five = blendSpells.filter(function (n) {
      return parseInt(n, 10) >= 1;
    });
    if (five.length < 5) {
      setStatus("Pick 5 Spellforge spells before casting.");
      return;
    }
    var alter = ($("ka-alter") && $("ka-alter").value) || "";
    var look = ($("ka-prompt") && $("ka-prompt").value) || (c.look && c.look.prompt) || "";
    var prompt = (
      "Logan Sevin Spellforge fusion portrait of catalog identity " +
      c.name +
      (c.show ? ", from " + c.show : "") +
      ". Keep this character's public identity — who they are, role, and vibe — as an ORIGINAL painterly gallery figure. " +
      "Do not copy official licensed stills, logos, title cards, or screenshots. " +
      (c.blurb ? c.blurb + " " : "") +
      "Spellforge DNA from paintings " +
      five.join(", ") +
      ". " +
      (look ? look + " " : "") +
      (alter ? "Studio alteration: " + alter + ". " : "") +
      "Full figure, dramatic light, no UI, no watermark, authored by Logan Sevin."
    ).slice(0, 4000);
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "kids-art-" + Date.now();
    setBusy(true, "image", "Casting " + c.name + " with 5 spells…");
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        fused_prompt: prompt,
        buzz_words: ["kids catalog", "painterly", "spellforge", "original character portrait", c.name],
        spells: five,
        aspect_ratio: "3:4",
        mag_fresh: true,
        fresh_variation: true,
        spell_cast: false,
        source: "kids-art",
      }),
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        var url = extractImageUrl(d);
        if (url) return url;
        if (res.status === 202 || d.job_id || jobId) return pollJob(d.job_id || jobId, "image");
        throw new Error(d.error || "Cast failed");
      })
      .then(function (url) {
        var hero = $("ka-hero");
        if (hero && url) {
          hero.src = url;
          hero.hidden = false;
        }
        return fetch(apiUrl("/api/kids-art/" + encodeURIComponent(c.id) + "/save"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: url,
            alter: alter,
            skin: alter || selectedSlug || "Default",
            name: c.name,
            show: c.show,
            blurb: c.blurb,
          }),
        }).then(function (r) {
          return r.json();
        });
      })
      .then(function (d) {
        if (!d || d.ok === false) throw new Error((d && d.error) || "Save failed");
        var savedFile = (d.skin && (d.skin.variant_file || d.skin.file)) || "";
        setStatus("Saved " + (savedFile || c.id));
        return loadSaved();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Cast failed");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function describeLook() {
    var c = byId(selectedId);
    if (!c || busy) return;
    if (!skinsOf(c).length) {
      setStatus("Cast a look first, then describe it.");
      return;
    }
    setBusy(true, "describe", "Transfer-reading " + c.name + "…");
    fetch(apiUrl("/api/kids-art/" + encodeURIComponent(c.id) + "/describe"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skin: selectedSlug,
        name: c.name,
        show: c.show,
        blurb: c.blurb,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || d.ok === false) throw new Error((d && d.error) || "Describe failed");
        if ($("ka-desc")) $("ka-desc").textContent = (d.look && d.look.description) || "";
        if ($("ka-prompt")) $("ka-prompt").value = (d.look && d.look.prompt) || "";
        setStatus("Look saved for " + c.name);
        return loadSaved();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Describe failed");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function animateLook() {
    var c = byId(selectedId);
    if (!c || busy) return;
    if (!skinsOf(c).length) {
      setStatus("Need a studio still first — Cast one.");
      return;
    }
    var action = ($("ka-anim-action") && $("ka-anim-action").value) || "idle";
    var custom = (($("ka-anim-custom") && $("ka-anim-custom").value) || "").trim();
    var motion =
      action === "custom" && custom
        ? custom
        : custom
          ? action.replace(/-/g, " ") + ". Also: " + custom
          : action.replace(/-/g, " ");
    var saveAction = (custom ? custom : action)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "idle";
    var duration = parseInt($("ka-anim-duration") && $("ka-anim-duration").value, 10);
    if ([6, 10, 15].indexOf(duration) < 0) duration = 10;
    var aspect = ($("ka-anim-aspect") && $("ka-anim-aspect").value) || "3:4";
    var still = absUrl(variantUrl(c, selectedSlug, selectedVariant));
    var prompt = (
      "ANIMATE this original Logan Sevin gallery figure of catalog identity " +
      c.name +
      ". Motion: " +
      motion +
      ". Keep identity, painterly, living figure, no UI, not an official screenshot. " +
      ((c.look && c.look.prompt) || "")
    ).slice(0, 2000);
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "kids-art-anim-" + Date.now();
    setBusy(true, "video", "Animating " + c.name + " · " + motion);
    fetch(apiUrl("/api/animate-cast"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        wait: false,
        wait_for_result: false,
        stasis: prompt,
        prompt: prompt,
        duration: duration,
        resolution: "720p",
        aspect_ratio: aspect,
        image_url: still,
        reference_image: still,
        source: "kids-art",
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        if (d.job_id || jobId) return pollJob(d.job_id || jobId, "video");
        var url = extractVideoUrl(d);
        if (url) return url;
        throw new Error(d.error || "Animate failed");
      })
      .then(function (url) {
        var vid = $("ka-video");
        if (vid && url) {
          vid.hidden = false;
          vid.src = url;
          vid.play().catch(function () {});
        }
        return fetch(apiUrl("/api/kids-art/" + encodeURIComponent(c.id) + "/animate-save"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video_url: url,
            action: saveAction,
            duration: duration,
            aspect_ratio: aspect,
          }),
        }).then(function (r) {
          return r.json();
        });
      })
      .then(function (d) {
        if (d && d.ok === false) throw new Error(d.error || "Anim save failed");
        setStatus("Saved animation for " + c.id);
        return loadSaved();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Animate failed");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function bind() {
    if (document.body.dataset.kaBound) return;
    document.body.dataset.kaBound = "1";
    $("ka-search") &&
      $("ka-search").addEventListener("input", function () {
        query = $("ka-search").value || "";
        renderGrid();
      });
    $("ka-net") &&
      $("ka-net").addEventListener("change", function () {
        net = $("ka-net").value || "all";
        renderGrid();
      });
    $("ka-cast") && $("ka-cast").addEventListener("click", castLook);
    $("ka-describe") && $("ka-describe").addEventListener("click", describeLook);
    $("ka-animate") && $("ka-animate").addEventListener("click", animateLook);
    $("ka-spell-prev") &&
      $("ka-spell-prev").addEventListener("click", function () {
        spellPage -= 1;
        renderSpellTray();
      });
    $("ka-spell-next") &&
      $("ka-spell-next").addEventListener("click", function () {
        spellPage += 1;
        renderSpellTray();
      });
    $("ka-spell-page-jump") &&
      $("ka-spell-page-jump").addEventListener("change", function () {
        var n = parseInt($("ka-spell-page-jump").value, 10);
        if (n >= 1) spellPage = n - 1;
        renderSpellTray();
      });
    $("ka-spell-search") &&
      $("ka-spell-search").addEventListener("input", function () {
        spellQuery = $("ka-spell-search").value || "";
        spellPage = 0;
        renderSpellTray();
      });
    $("ka-spell-source") &&
      $("ka-spell-source").addEventListener("change", function () {
        spellSource = $("ka-spell-source").value || "all";
        spellPage = 0;
        renderSpellTray();
      });
    $("ka-spell-jump") &&
      $("ka-spell-jump").addEventListener("change", function () {
        var n = parseInt($("ka-spell-jump").value, 10);
        if (n > 0) placeSpell(n);
      });
  }

  function onShow() {
    bind();
    mergeRoster();
    loadPortraitCache().then(function () {
      mergeRoster();
      renderGrid();
      if (selectedId && byId(selectedId)) selectChar(selectedId, true);
    });
    renderGrid();
    bootBook();
    loadSaved();
    if (window.SpellforgeAPI && window.SpellforgeAPI.whenReady) {
      window.SpellforgeAPI.whenReady().then(bootBook);
    }
    booted = true;
  }

  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "kids-art") onShow();
  });
  window.addEventListener("kids-art-show", onShow);

  window.KidsArt = { onShow: onShow };
})();
