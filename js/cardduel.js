/**
 * Spell Card Duel — turn-based LoR / MTG / Yugioh-style board.
 * Cards from gallery spells + generated; board units block face damage;
 * Attack with all ready units, or Fuse two into a brand-new card (ends turn).
 * Modes: vs CPU, or LAN room on the gallery server (same Wi‑Fi as Fight).
 */
(function () {
  "use strict";

  var PLAYER_HP = 30;
  var MAX_BOARD = 5;
  var HAND_SIZE = 7;
  var DECK_SIZE = 60;
  var MAX_HAND = 12;
  var MAX_MANA = 10;
  var FUSE_MIN = 2;
  var FUSE_MAX = 5;

  var EFFECTS = {
    taunt: {
      name: "Taunt",
      desc: "Enemies must attack this unit before other units or your hero.",
      onPlay: null,
    },
    rush: {
      name: "Rush",
      desc: "Can attack the same turn it is played (otherwise wait one turn).",
      onPlay: function (card) {
        card.canAttack = true;
      },
    },
    lifesteal: {
      name: "Lifesteal",
      desc: "When this deals damage, heal your hero for the same amount.",
      onPlay: null,
    },
    shield: {
      name: "Shield",
      desc: "The first damage this takes is ignored (shield breaks).",
      onPlay: function (card) {
        card.shield = true;
      },
    },
    burn: {
      name: "Burn",
      desc: "On play: deal 1 damage to the enemy hero (ignores field).",
      onPlay: function (card, g, owner) {
        var foe = owner === "you" ? g.enemy : g.you;
        foe.hp = Math.max(0, foe.hp - 1);
        log(g, card.name + " burns the enemy hero for 1.");
      },
    },
    draw: {
      name: "Draw",
      desc: "On play: draw 1 card from your deck.",
      onPlay: function (card, g, owner) {
        drawOne(g, owner === "you" ? g.you : g.enemy, owner);
      },
    },
    heal: {
      name: "Heal",
      desc: "On play: restore 2 HP to your hero (max 30).",
      onPlay: function (card, g, owner) {
        var p = owner === "you" ? g.you : g.enemy;
        p.hp = Math.min(PLAYER_HP, p.hp + 2);
        log(g, card.name + " heals its hero for 2.");
      },
    },
    buff: {
      name: "Rally",
      desc: "On play: give all other friendly field units +1 Attack and +1 Health.",
      onPlay: function (card, g, owner) {
        var board = owner === "you" ? g.you.board : g.enemy.board;
        board.forEach(function (c) {
          if (c && c.id !== card.id) {
            c.atk += 1;
            c.hp += 1;
            c.maxHp += 1;
          }
        });
        log(g, card.name + " rallies allies +1/+1.");
      },
    },
    pierce: {
      name: "Pierce",
      desc: "Extra damage after destroying a unit hits the enemy hero.",
      onPlay: null,
    },
  };

  var EFFECT_KEYS = Object.keys(EFFECTS);

  var g = null;
  var pool = { spells: [], generated: [], sketches: [], loaded: false, loading: false };
  var lan = {
    room: "",
    playerId: "",
    poll: 0,
    isHost: false,
    mode: "cpu",
    displayName: "",
    players: [],
    announced: {},
  };
  var ui = {
    selectedHand: null,
    selectedBoard: null,
    /** Board indices selected for weave (2–5 units) */
    fusionSelected: [],
    /**
     * Your board indices held back from "Attack with all ready".
     * Directed attacks still work; Attack All skips these.
     */
    attackHold: {},
    /** Hand sort: mana | atk | hp | name */
    handSort: "mana",
    anim: null, // { type, fromOwner, fromIdx, toOwner, toIdx, label }
    busy: false,
    /** Sticky lock after credits run out (cleared when HUD shows balance again) */
    creditsBlocked: false,
    /** Auto-join from invite link once */
    inviteJoinPending: null,
  };

  function isAttackHeld(idx) {
    return !!(ui.attackHold && ui.attackHold[idx]);
  }

  function toggleAttackHold(idx) {
    if (!g || g.turnOf !== "you") return;
    var card = g.you.board[idx];
    if (!card || !isReadyAttacker(card)) {
      setStatus("Only ready attackers can be held back from Attack All.", true);
      return;
    }
    if (ui.attackHold[idx]) {
      delete ui.attackHold[idx];
      setStatus(
        card.name + " will join Attack All again. (Directed strikes always work.)"
      );
    } else {
      ui.attackHold[idx] = true;
      if (ui.selectedBoard === idx) {
        ui.selectedBoard = null;
        if (g.phase === "attack") g.phase = "main";
      }
      setStatus(
        card.name +
          " held — skipped by Attack All. Click it again (no Shift) to direct-attack, or Shift+click to unhold."
      );
    }
    render();
  }

  function clearAttackHolds() {
    ui.attackHold = {};
  }

  function heldAttackerCount() {
    var n = 0;
    if (!g) return 0;
    for (var i = 0; i < MAX_BOARD; i++) {
      if (isAttackHeld(i) && isReadyAttacker(g.you.board[i])) n++;
    }
    return n;
  }

  function isCreditsError(msg) {
    if (!msg) return false;
    var m = String(msg).toLowerCase();
    return (
      m.indexOf("credit") >= 0 ||
      m.indexOf("quota") >= 0 ||
      m.indexOf("billing") >= 0 ||
      m.indexOf("payment") >= 0 ||
      m.indexOf("insufficient") >= 0 ||
      m.indexOf("license") >= 0 ||
      m.indexOf("purchase") >= 0 ||
      m.indexOf("402") >= 0
    );
  }

  /** true if weave may spend API credits (false when known empty / blocked). */
  function canUseWeaveCredits() {
    var hud = window.XaiCreditsHud;
    if (hud && typeof hud.hasSpendableCredits === "function") {
      var h = hud.hasSpendableCredits(0.01);
      if (h === false) {
        ui.creditsBlocked = true;
        return false;
      }
      if (h === true) {
        ui.creditsBlocked = false;
        return true;
      }
    } else if (hud && typeof hud.getLast === "function") {
      var d = hud.getLast();
      if (d && d.ok) {
        if (d.credits_usd != null && Number(d.credits_usd) < 0.01) {
          ui.creditsBlocked = true;
          return false;
        }
        if (d.week_remaining_usd != null && Number(d.week_remaining_usd) < 0.01) {
          ui.creditsBlocked = true;
          return false;
        }
        if (d.credits_usd != null && Number(d.credits_usd) >= 0.01) {
          ui.creditsBlocked = false;
        }
      }
    }
    if (ui.creditsBlocked) return false;
    return true;
  }

  function markCreditsBlocked() {
    ui.creditsBlocked = true;
    try {
      if (window.XaiCreditsHud && typeof window.XaiCreditsHud.refresh === "function") {
        window.XaiCreditsHud.refresh(true);
      } else if (window.dispatchEvent) {
        window.dispatchEvent(new Event("xai-usage-refresh"));
      }
    } catch (e) {}
  }

  /** Fresh check before spending; rejects when out of credits (no retries). */
  function ensureCreditsForWeave() {
    var hud = window.XaiCreditsHud;
    if (!hud || typeof hud.refresh !== "function") {
      if (!canUseWeaveCredits()) {
        return Promise.reject(
          new Error("Out of xAI credits — weave disabled.")
        );
      }
      return Promise.resolve();
    }
    return hud.refresh(true).then(function (data) {
      if (data && data.ok) {
        if (data.credits_usd != null && Number(data.credits_usd) < 0.01) {
          ui.creditsBlocked = true;
          throw new Error("Out of xAI credits — weave disabled.");
        }
        if (
          data.week_remaining_usd != null &&
          Number(data.week_remaining_usd) < 0.01
        ) {
          ui.creditsBlocked = true;
          throw new Error("Weekly usage exhausted — weave disabled.");
        }
        ui.creditsBlocked = false;
      } else if (ui.creditsBlocked) {
        throw new Error("Out of xAI credits — weave disabled.");
      }
    });
  }

  function updateWeaveCreditsUi() {
    var creditsOk = canUseWeaveCredits();
    var fuseMode = $("cd-fusion-mode");
    var fuseBtn = $("cd-forge-fusion");
    var fuseBar = document.querySelector(".cd-fusion-bar");
    var promptEl = $("cd-fusion-prompt");
    if (fuseMode) {
      fuseMode.disabled = !creditsOk;
      if (!creditsOk && fuseMode.checked) {
        fuseMode.checked = false;
        clearFusionSelect();
      }
    }
    if (promptEl) promptEl.disabled = !creditsOk;
    if (fuseBar) fuseBar.classList.toggle("is-credits-blocked", !creditsOk);
    if (fuseBtn && !creditsOk) {
      fuseBtn.disabled = true;
      fuseBtn.textContent = "Weave disabled (no credits)";
      fuseBtn.title =
        "Add xAI credits at console.x.ai — weave will unlock after a refresh.";
    }
  }

  function clearFusionSelect() {
    ui.fusionSelected = [];
  }

  function isFusionSelected(idx) {
    return ui.fusionSelected.indexOf(idx) >= 0;
  }

  function toggleFusionSelect(idx) {
    if (!canUseWeaveCredits()) {
      setStatus("No API credits — weave is disabled.", true);
      updateWeaveCreditsUi();
      return;
    }
    var i = ui.fusionSelected.indexOf(idx);
    if (i >= 0) {
      ui.fusionSelected.splice(i, 1);
      return;
    }
    if (ui.fusionSelected.length >= FUSE_MAX) {
      setStatus("Weave max is " + FUSE_MAX + " units. Deselect one first.", true);
      return;
    }
    ui.fusionSelected.push(idx);
  }

  function fusionSelectStatus() {
    var n = ui.fusionSelected.length;
    if (n === 0) return "Weave: pick " + FUSE_MIN + "–" + FUSE_MAX + " of your units, then Weave cards.";
    if (n < FUSE_MIN) {
      return "Weave: " + n + " selected — need at least " + FUSE_MIN + ".";
    }
    if (n >= FUSE_MAX) {
      return "Weave: " + n + " selected (max). Ready to Weave cards (ends turn).";
    }
    return "Weave: " + n + " selected — pick more (up to " + FUSE_MAX + ") or Weave cards.";
  }

  var TITLE_ADJECTIVES = [
    "Verdant",
    "Crimson",
    "Gilded",
    "Midnight",
    "Luminous",
    "Hollow",
    "Storm",
    "Silent",
    "Bronze",
    "Ivory",
    "Ashen",
    "Molten",
    "Frozen",
    "Veiled",
    "Radiant",
    "Spectral",
    "Ember",
    "Tide",
    "Obsidian",
    "Pearl",
  ];
  var TITLE_NOUNS = [
    "Procession",
    "Reliquary",
    "Horizon",
    "Warden",
    "Bloom",
    "Echo",
    "Throne",
    "Cascade",
    "Vigil",
    "Orchard",
    "Lantern",
    "Cathedral",
    "Mirage",
    "Crown",
    "Spire",
    "Garden",
    "Rift",
    "Chorus",
    "Vessel",
    "Omen",
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function apiUrl(path) {
    var base = window.SPELLFORGE_API_BASE
      ? String(window.SPELLFORGE_API_BASE).replace(/\/$/, "")
      : "";
    return base + path;
  }

  function uid() {
    return (
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "c" + Date.now() + Math.random().toString(36).slice(2, 8)
      ).replace(/-/g, "").slice(0, 16)
    );
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function log(game, msg) {
    if (!game) return;
    game.logLines = game.logLines || [];
    game.logLines.unshift(msg);
    if (game.logLines.length > 40) game.logLines.length = 40;
  }

  function paintingUrl(num) {
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function resolveUrl(url) {
    var raw = String(url || "").trim();
    if (!raw) return "";
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    try {
      return new URL(raw, window.location.href).href;
    } catch (e) {
      return raw;
    }
  }

  function analysisFor(num) {
    if (num != null && window.getGalleryAnalysis) {
      return window.getGalleryAnalysis(num) || null;
    }
    return null;
  }

  function isTackyTitle(t) {
    t = String(t || "").trim();
    if (!t) return true;
    if (/^(generated|spell|fusion|fuse|lod1|card)\b/i.test(t)) return true;
    if (/generated\s*#|spell\s*#|fusion\s+/i.test(t)) return true;
    if (/^#?\d+(\.jpe?g)?$/i.test(t)) return true;
    if (/^\d+\.(jpe?g|png|webp)$/i.test(t)) return true;
    return false;
  }

  function cleanCompositionTitle(raw) {
    var t = String(raw || "")
      .replace(/\s+/g, " ")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    if (isTackyTitle(t)) return "";
    // Keep short title case
    if (t.length > 34) {
      t = t.slice(0, 34).replace(/\s+\S*$/, "").trim();
    }
    return t;
  }

  function inventCompositionTitle(seed, a, extras) {
    extras = extras || {};
    var tags = ((a && a.tags) || extras.tags || [])
      .map(function (x) {
        return String(x || "").trim();
      })
      .filter(function (x) {
        return x && !isTackyTitle(x) && x.length < 18;
      });
    var mood = String((a && a.mood) || extras.mood || "")
      .split(/[,/|]/)[0]
      .trim();
    var desc = String((a && a.description) || extras.description || "").trim();
    var h = 0;
    var s = String(seed || "card");
    for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
    h = Math.abs(h);

    if (tags.length >= 2) {
      var t0 = tags[h % tags.length];
      var t1 = tags[(h >> 3) % tags.length];
      if (t0.toLowerCase() !== t1.toLowerCase()) {
        return cleanCompositionTitle(t0 + " " + t1) || cleanCompositionTitle(t0);
      }
      return cleanCompositionTitle(t0);
    }
    if (tags.length === 1 && mood && !isTackyTitle(mood)) {
      return cleanCompositionTitle(mood.split(/\s+/)[0] + " " + tags[0]);
    }
    if (desc) {
      var words = desc
        .replace(/[^a-zA-Z\s]/g, " ")
        .split(/\s+/)
        .filter(function (w) {
          return w.length > 3 && !/^(with|from|that|this|into|over|under|their|have|been)$/i.test(w);
        });
      if (words.length >= 2) {
        return cleanCompositionTitle(words[0] + " " + words[1]);
      }
      if (words.length === 1) {
        return cleanCompositionTitle(
          TITLE_ADJECTIVES[h % TITLE_ADJECTIVES.length] + " " + words[0]
        );
      }
    }
    return (
      TITLE_ADJECTIVES[h % TITLE_ADJECTIVES.length] +
      " " +
      TITLE_NOUNS[(h >> 4) % TITLE_NOUNS.length]
    );
  }

  /** Display name for a card: composition title only — never Generated # / Fusion / file numbers. */
  function compositionTitleFor(item, a) {
    a = a || analysisFor(item && (item.num != null ? item.num : item.paintingNum));
    var candidates = [
      item && item.title,
      item && item.metaTitle,
      a && a.title,
      item && item.label,
    ];
    for (var i = 0; i < candidates.length; i++) {
      var c = cleanCompositionTitle(candidates[i]);
      if (c) return c;
    }
    return inventCompositionTitle(
      (item && (item.num || item.url || item.label)) || "x",
      a,
      item || {}
    );
  }

  function inventFusedTitle(cards, promptText) {
    cards = cards || [];
    var bits = [];
    function pushWords(str) {
      String(str || "")
        .replace(/[^a-zA-Z\s]/g, " ")
        .split(/\s+/)
        .forEach(function (w) {
          if (w.length > 3 && !isTackyTitle(w) && bits.indexOf(w) < 0) bits.push(w);
        });
    }
    cards.forEach(function (c) {
      pushWords(c && c.name);
    });
    pushWords(promptText);
    if (bits.length >= 2) {
      return (
        cleanCompositionTitle(bits[0] + " " + bits[1]) ||
        inventCompositionTitle(bits.join(""), null, {})
      );
    }
    if (bits.length === 1) {
      return cleanCompositionTitle(
        TITLE_ADJECTIVES[bits[0].length % TITLE_ADJECTIVES.length] + " " + bits[0]
      );
    }
    var seed = cards
      .map(function (c) {
        return (c && c.id) || "";
      })
      .join("");
    return inventCompositionTitle(seed || "weave", null, {});
  }

  function inventCpuFusionPrompt(cards) {
    cards = cards || [];
    var moods = [
      "nocturnal oil-storm",
      "gilded ruin light",
      "wet-varnish cathedral",
      "ember-silk horizon",
      "tidal bronze hush",
      "fractured glass dawn",
      "moss-lit reliquary",
      "copper-smoke processional",
      "choir of cracked gilding",
      "ink-river aurora",
    ];
    var verbs = [
      "braids into",
      "dissolves through",
      "crowns",
      "haunts",
      "unfolds from",
      "echoes inside",
      "refract through",
      "constellates with",
    ];
    var h = 0;
    var s =
      cards
        .map(function (c) {
          return (c && c.name) || "";
        })
        .join("|") + Date.now();
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    h = Math.abs(h);
    var mood = moods[h % moods.length];
    var verb = verbs[(h >> 3) % verbs.length];
    var detail = moods[(h >> 5) % moods.length];
    var names = cards
      .map(function (c) {
        return "“" + ((c && c.name) || "a vision") + "”";
      })
      .join(", ");
    if (cards.length <= 2) {
      return (
        "A singular new figure: the essence of " +
        names +
        " " +
        verb +
        " one another, " +
        mood +
        ", " +
        detail +
        ", one hero subject, painterly, no collage panels, no text"
      );
    }
    return (
      "A singular new figure born from a " +
      cards.length +
      "-part weave of " +
      names +
      ", " +
      mood +
      " that " +
      verb +
      " layered motifs into one body, " +
      detail +
      ", one hero subject, painterly, no collage, no text"
    );
  }

  function pickEffect(seed, tags, mood) {
    var blob = (tags || []).join(" ") + " " + (mood || "") + " " + seed;
    var low = blob.toLowerCase();
    if (/shield|armor|guard|wall/.test(low)) return "shield";
    if (/taunt|guard|tank|protect/.test(low)) return "taunt";
    if (/rush|speed|swift|quick/.test(low)) return "rush";
    if (/heal|life|heart|gentle|kind/.test(low)) return "heal";
    if (/blood|life.?steal|vamp/.test(low)) return "lifesteal";
    if (/fire|burn|flame|ember/.test(low)) return "burn";
    if (/draw|mind|book|study|wisdom/.test(low)) return "draw";
    if (/army|crowd|group|rally|horn/.test(low)) return "buff";
    if (/pierce|spear|arrow|sharp/.test(low)) return "pierce";
    var h = 0;
    for (var i = 0; i < String(seed).length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return EFFECT_KEYS[Math.abs(h) % EFFECT_KEYS.length];
  }

  function statsFromSeed(seed, a) {
    var h = 0;
    var s = String(seed);
    for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
    h = Math.abs(h);
    var cost = 1 + (h % 5);
    var atk = 1 + ((h >> 3) % 6);
    var hp = 1 + ((h >> 7) % 7);
    if (a && a.mood) {
      var m = String(a.mood).toLowerCase();
      if (/dark|void|rage|fierce/.test(m)) atk += 1;
      if (/calm|soft|peace|gentle/.test(m)) hp += 1;
    }
    cost = Math.min(6, Math.max(1, cost));
    atk = Math.min(8, Math.max(1, atk));
    hp = Math.min(10, Math.max(1, hp));
    return { cost: cost, atk: atk, hp: hp };
  }

  function makeCardFromItem(item) {
    var num = item.num != null ? item.num : item.paintingNum;
    var a = analysisFor(num) || item.analysis || null;
    var name = compositionTitleFor(item, a);
    var st = statsFromSeed(String(num || item.url || name), a);
    var effectKey = pickEffect(String(num || name), (a && a.tags) || item.tags || [], (a && a.mood) || item.mood);
    return {
      id: uid(),
      name: name,
      kind:
        item.kind === "generated"
          ? "studio"
          : item.kind === "sketch"
            ? "sketch"
            : "gallery",
      fileNum: num || null, // file id only — never shown as the card title
      num: num || null,
      url: resolveUrl(item.url || (num ? paintingUrl(num) : "")),
      cost: st.cost,
      atk: st.atk,
      hp: st.hp,
      maxHp: st.hp,
      effect: effectKey,
      canAttack: false,
      shield: false,
      exhausted: false,
      fusion: false,
    };
  }

  function cloneCard(c) {
    return JSON.parse(JSON.stringify(c));
  }

  function loadPool() {
    if (pool.loading) return pool._p;
    if (pool.loaded) return Promise.resolve();
    pool.loading = true;
    var spellsP = fetch("data/manifest.json?t=" + Date.now())
      .then(function (r) {
        return r.ok ? r.json() : [];
      })
      .then(function (man) {
        var nums = [];
        if (Array.isArray(man)) {
          man.forEach(function (row) {
            if (typeof row === "number") nums.push(row);
            else if (row && row.number != null) nums.push(Number(row.number));
            else if (row && row.num != null) nums.push(Number(row.num));
          });
        } else if (man && Array.isArray(man.paintings)) {
          man.paintings.forEach(function (n) {
            nums.push(Number(n));
          });
        }
        nums = nums.filter(function (n) {
          return isFinite(n) && n > 0;
        });
        if (!nums.length) {
          for (var i = 1; i <= 80; i++) nums.push(i);
        }
        pool.spells = shuffle(nums)
          .slice(0, 120)
          .map(function (n) {
            var a = analysisFor(n);
            return {
              kind: "spell",
              num: n,
              title: a && a.title ? a.title : "",
              label: "",
              url: resolveUrl(paintingUrl(n)),
              analysis: a,
              tags: (a && a.tags) || [],
              mood: (a && a.mood) || "",
            };
          });
      })
      .catch(function () {
        var nums = [];
        for (var i = 1; i <= 60; i++) nums.push(i);
        pool.spells = shuffle(nums).map(function (n) {
          return {
            kind: "spell",
            num: n,
            title: "",
            url: resolveUrl(paintingUrl(n)),
          };
        });
      });

    var genUrl =
      (window.SPELLFORGE_API_BASE
        ? String(window.SPELLFORGE_API_BASE).replace(/\/$/, "")
        : "") + "/api/lod1-manifest?t=" + Date.now();
    var genP = fetch(genUrl)
      .then(function (r) {
        if (r.ok) return r.json();
        return fetch("data/lod1-manifest.json?t=" + Date.now()).then(function (r2) {
          return r2.ok ? r2.json() : { items: [] };
        });
      })
      .then(function (data) {
        var items = (data && data.items) || [];
        pool.generated = shuffle(items)
          .slice(0, 100)
          .map(function (item) {
            var name = item.name || item.num + ".jpg";
            var url = item.url || "/generated/" + name;
            return {
              kind: "generated",
              num: item.num,
              title: item.title || "",
              label: "",
              url: resolveUrl(url),
            };
          });
      })
      .catch(function () {
        pool.generated = [];
      });

    var skUrl =
      (window.SPELLFORGE_API_BASE
        ? String(window.SPELLFORGE_API_BASE).replace(/\/$/, "")
        : "") + "/api/sketch-manifest?t=" + Date.now();
    var skP = fetch(skUrl)
      .then(function (r) {
        if (r.ok) return r.json();
        return { items: [] };
      })
      .then(function (data) {
        var items = (data && data.items) || [];
        pool.sketches = shuffle(items)
          .slice(0, 100)
          .map(function (item) {
            var n = item.num;
            var url = item.url || "/sketches/" + n + ".png";
            return {
              kind: "sketch",
              num: n,
              title: "",
              label: "S#" + n,
              url: resolveUrl(url),
            };
          });
      })
      .catch(function () {
        pool.sketches = [];
      });

    pool._p = Promise.all([spellsP, genP, skP])
      .then(function () {
        // Hydrate composition titles from generated-meta sidecars
        var slice = pool.generated.slice(0, 80);
        return Promise.all(
          slice.map(function (it) {
            if (it.num == null) return null;
            return fetch("generated-meta/" + it.num + ".json", { cache: "force-cache" })
              .then(function (r) {
                return r.ok ? r.json() : null;
              })
              .then(function (meta) {
                if (!meta) return;
                it.title = meta.title || it.title || "";
                it.tags = meta.tags || [];
                it.mood = meta.mood || "";
                it.description = meta.description || "";
                it.analysis = meta;
              })
              .catch(function () {});
          })
        );
      })
      .then(function () {
        // Hydrate sketch prompts from sketches-meta
        var slice = (pool.sketches || []).slice(0, 80);
        return Promise.all(
          slice.map(function (it) {
            if (it.num == null) return null;
            return fetch("sketches-meta/" + it.num + ".json", { cache: "force-cache" })
              .then(function (r) {
                return r.ok ? r.json() : null;
              })
              .then(function (meta) {
                if (!meta) return;
                it.title = meta.title || it.title || "";
                it.tags = meta.tags || [];
                it.mood = meta.mood || "";
                it.description = meta.description || "";
                it.prompt = meta.prompt || "";
                it.analysis = meta;
              })
              .catch(function () {});
          })
        );
      })
      .then(function () {
        pool.loading = false;
        pool.loaded = true;
      });
    return pool._p;
  }

  function buildDeck() {
    var mixed = shuffle(
      pool.spells.concat(pool.generated).concat(pool.sketches || [])
    );
    if (mixed.length < DECK_SIZE) {
      mixed = mixed.concat(shuffle(pool.spells)).slice(0, DECK_SIZE);
    }
    return shuffle(mixed)
      .slice(0, DECK_SIZE)
      .map(makeCardFromItem);
  }

  function makeSide(name, isCpu) {
    var deck = buildDeck();
    return {
      name: name,
      isCpu: !!isCpu,
      hp: PLAYER_HP,
      mana: 0,
      maxMana: 0,
      deck: deck,
      hand: [],
      board: emptyBoard(),
    };
  }

  function emptyBoard() {
    var b = [];
    for (var i = 0; i < MAX_BOARD; i++) b.push(null);
    return b;
  }

  function drawOne(game, side, label) {
    if (!side.deck.length) {
      log(game, (label || side.name) + " has no cards left to draw.");
      return null;
    }
    var c = side.deck.shift();
    if (side.hand.length >= MAX_HAND) {
      log(game, (label || side.name) + " discards " + c.name + " (hand full).");
      return null;
    }
    side.hand.push(c);
    return c;
  }

  /** Draw until hand has `target` cards (default 7). No free +1 if already full. */
  function fillHandTo(game, side, label, target) {
    target = target == null ? HAND_SIZE : target;
    var drawn = [];
    while (side.hand.length < target) {
      var c = drawOne(game, side, label);
      if (!c) break;
      drawn.push(c);
    }
    return drawn;
  }

  function freeBoardSlot(side) {
    for (var i = 0; i < MAX_BOARD; i++) {
      if (!side.board[i]) return i;
    }
    return -1;
  }

  function livingBoard(side) {
    return side.board.filter(function (c) {
      return c && c.hp > 0;
    });
  }

  function hasTaunt(side) {
    return livingBoard(side).some(function (c) {
      return c.effect === "taunt";
    });
  }

  function isReadyAttacker(card) {
    return !!(card && card.canAttack && !card.exhausted && card.hp > 0);
  }

  function readyAttackerCount(side, opts) {
    opts = opts || {};
    var n = 0;
    if (!side || !side.board) return 0;
    for (var i = 0; i < side.board.length; i++) {
      if (!isReadyAttacker(side.board[i])) continue;
      if (opts.skipHeld && g && side === g.you && isAttackHeld(i)) continue;
      n++;
    }
    return n;
  }

  /** Valid enemy targets for the current attack selection (or general availability). */
  function getAttackTargetInfo(game) {
    var info = {
      ready: 0,
      readyNames: [],
      readyIdxs: [],
      unitIdxs: [],
      unitNames: [],
      heroOpen: false,
      hasTaunt: false,
      selectedName: "",
    };
    if (!game || game.phase === "ended" || game.turnOf !== "you") return info;
    for (var i = 0; i < MAX_BOARD; i++) {
      var c = game.you.board[i];
      if (isReadyAttacker(c)) {
        info.ready++;
        info.readyNames.push(c.name);
        info.readyIdxs.push(i);
      }
    }
    if (ui.selectedBoard != null && game.you.board[ui.selectedBoard]) {
      info.selectedName = game.you.board[ui.selectedBoard].name;
    }
    info.hasTaunt = hasTaunt(game.enemy);
    var units = livingBoard(game.enemy);
    if (!units.length) {
      info.heroOpen = true;
    } else {
      for (var j = 0; j < MAX_BOARD; j++) {
        var e = game.enemy.board[j];
        if (!e || e.hp <= 0) continue;
        if (info.hasTaunt && e.effect !== "taunt") continue;
        info.unitIdxs.push(j);
        info.unitNames.push(e.name + (e.effect === "taunt" ? " (Taunt)" : ""));
      }
    }
    return info;
  }

  function updateAttackIndicator() {
    var el = $("cd-attack-indicator");
    if (!el) return;
    if (!g || g.phase === "ended" || g.turnOf !== "you" || ui.busy) {
      el.hidden = true;
      el.className = "cd-attack-indicator";
      el.innerHTML = "";
      return;
    }
    var info = getAttackTargetInfo(g);
    var fuseMode = $("cd-fusion-mode") && $("cd-fusion-mode").checked;
    el.hidden = false;

    if (fuseMode || ui.fusionSelected.length) {
      el.className = "cd-attack-indicator is-weave";
      el.innerHTML =
        "<strong>Weave mode</strong> — pick 2–5 of your field units, then Weave. Attack highlights are paused.";
      return;
    }

    if (!info.ready) {
      el.className = "cd-attack-indicator is-idle";
      el.innerHTML =
        "<div class=\"cd-attack-grid\">" +
        "<div class=\"cd-attack-col\">" +
        "<span class=\"cd-attack-col-label is-muted\">Can attack</span>" +
        "<span class=\"cd-attack-col-body\">None yet</span>" +
        "<span class=\"cd-attack-col-hint\">Need Rush, or rest one turn after play</span>" +
        "</div>" +
        "<div class=\"cd-attack-col\">" +
        "<span class=\"cd-attack-col-label is-muted\">Available targets</span>" +
        "<span class=\"cd-attack-col-body\">—</span>" +
        "<span class=\"cd-attack-col-hint\">No ready attackers this turn</span>" +
        "</div>" +
        "</div>";
      return;
    }

    var targetsHtml;
    var targetsHint;
    if (info.heroOpen) {
      targetsHtml =
        "<span class=\"cd-attack-pill is-hero\">Enemy hero (open)</span>";
      targetsHint =
        ui.selectedBoard != null
          ? "Click the glowing enemy hero or Strike hero"
          : "Select a green unit, then strike the open hero";
    } else {
      targetsHtml = info.unitNames
        .map(function (n) {
          var taunt = /\(Taunt\)/.test(n);
          return (
            "<span class=\"cd-attack-pill is-target" +
            (taunt ? " is-taunt" : "") +
            "\">" +
            escapeHtml(n) +
            "</span>"
          );
        })
        .join("");
      if (!targetsHtml) targetsHtml = "<span class=\"cd-attack-col-body\">—</span>";
      targetsHint = info.hasTaunt
        ? "Taunt must be hit first · hero blocked"
        : "Any enemy unit · hero blocked until field is clear";
    }

    var attackersHtml = info.readyNames
      .map(function (n, i) {
        var isSel =
          ui.selectedBoard != null && info.readyIdxs[i] === ui.selectedBoard;
        return (
          "<span class=\"cd-attack-pill is-ready" +
          (isSel ? " is-selected-attacker" : "") +
          "\">" +
          escapeHtml(n) +
          "</span>"
        );
      })
      .join("");

    if (ui.selectedBoard != null) {
      el.className = "cd-attack-indicator is-targeting";
    } else {
      el.className = "cd-attack-indicator is-ready";
    }

    el.innerHTML =
      "<div class=\"cd-attack-head\">" +
      (ui.selectedBoard != null
        ? "<strong>Choose a target</strong> for " +
          escapeHtml(info.selectedName || "your unit")
        : "<strong>You can attack</strong> — " +
          info.ready +
          " ready · <em>direct:</em> click green → red target · <em>or</em> Attack All" +
          (heldAttackerCount()
            ? " · <span class=\"cd-attack-held-note\">" +
              heldAttackerCount() +
              " held from All</span>"
            : "") +
          " · Shift+click to hold") +
      "</div>" +
      "<div class=\"cd-attack-grid\">" +
      "<div class=\"cd-attack-col\">" +
      "<span class=\"cd-attack-col-label is-ready-lab\">Can attack (" +
      info.ready +
      ")</span>" +
      "<div class=\"cd-attack-pills\">" +
      attackersHtml +
      "</div>" +
      "<span class=\"cd-attack-col-hint\">" +
      (ui.selectedBoard != null
        ? "Click another green unit to switch attacker"
        : "Click a green card, or Attack with all ready") +
      "</span>" +
      "</div>" +
      "<div class=\"cd-attack-col\">" +
      "<span class=\"cd-attack-col-label is-target-lab\">Available to attack</span>" +
      "<div class=\"cd-attack-pills\">" +
      targetsHtml +
      "</div>" +
      "<span class=\"cd-attack-col-hint\">" +
      escapeHtml(targetsHint) +
      "</span>" +
      "</div>" +
      "</div>";
  }

  function startTurn(game, who) {
    game.turnOf = who;
    game.phase = "main";
    game.attacksLeft = true;
    var side = who === "you" ? game.you : game.enemy;
    var label = who === "you" ? "You" : side.name;
    side.maxMana = Math.min(MAX_MANA, (side.maxMana || 0) + 1);
    side.mana = side.maxMana;
    side.board.forEach(function (c) {
      if (c) {
        c.canAttack = true;
        c.exhausted = false;
      }
    });
    // Refill to 7 — not a free +1 (avoids turn-1 hand of 8)
    var filled = fillHandTo(game, side, label, HAND_SIZE);
    if (filled.length) {
      log(
        game,
        label +
          " refill hand +" +
          filled.length +
          " → " +
          side.hand.length +
          (filled.length <= 3
            ? " (" +
              filled
                .map(function (c) {
                  return c.name;
                })
                .join(", ") +
              ")"
            : "")
      );
    } else if (side.hand.length >= HAND_SIZE) {
      log(game, label + " hand full (" + HAND_SIZE + ") — no draw.");
    }
    log(game, (who === "you" ? "Your" : side.name + "'s") + " turn — mana " + side.mana + ".");
    ui.selectedHand = null;
    ui.selectedBoard = null;
    clearFusionSelect();
    if (who === "you") clearAttackHolds();
  }

  function checkWinner(game) {
    if (game.you.hp <= 0) {
      game.phase = "ended";
      game.winner = "enemy";
      log(game, "Defeat — " + game.enemy.name + " wins.");
      return true;
    }
    if (game.enemy.hp <= 0) {
      game.phase = "ended";
      game.winner = "you";
      log(game, "Victory!");
      return true;
    }
    return false;
  }

  function dealDamageToCard(game, card, dmg, attacker, attackerOwner) {
    if (!card || dmg <= 0) return 0;
    if (card.shield) {
      card.shield = false;
      log(game, card.name + " loses Shield.");
      return 0;
    }
    card.hp -= dmg;
    if (attacker && attacker.effect === "lifesteal") {
      var p = attackerOwner === "you" ? game.you : game.enemy;
      p.hp = Math.min(PLAYER_HP, p.hp + dmg);
    }
    return dmg;
  }

  function removeDead(game, side) {
    for (var i = 0; i < side.board.length; i++) {
      var c = side.board[i];
      if (c && c.hp <= 0) {
        log(game, c.name + " is destroyed.");
        side.board[i] = null;
      }
    }
  }

  function playCardFromHand(game, handIdx) {
    if (game.phase !== "main" || game.turnOf !== "you") return;
    var card = game.you.hand[handIdx];
    if (!card) return;
    if (card.cost > game.you.mana) {
      setStatus("Not enough mana (" + card.cost + " needed).", true);
      return;
    }
    var slot = freeBoardSlot(game.you);
    if (slot < 0) {
      setStatus("Board full (max " + MAX_BOARD + ").", true);
      return;
    }
    game.you.mana -= card.cost;
    game.you.hand.splice(handIdx, 1);
    var unit = cloneCard(card);
    unit.canAttack = unit.effect === "rush";
    unit.exhausted = !unit.canAttack;
    game.you.board[slot] = unit;
    log(game, "You play " + unit.name + " (" + unit.atk + "/" + unit.hp + ").");
    var fx = EFFECTS[unit.effect];
    if (fx && fx.onPlay) fx.onPlay(unit, game, "you");
    ui.selectedHand = null;
    setStatus("");
    render();
    pushLanIfNeeded();
  }

  function cancelAttackSelect() {
    if (!g) return;
    ui.selectedBoard = null;
    if (g.phase === "attack") g.phase = "main";
    setStatus(
      "Direct attack cancelled. Click a green unit to pick a target, or Attack All (skips held)."
    );
    render();
  }

  function beginAttackSelect(boardIdx) {
    if (!g || g.phase === "ended" || g.turnOf !== "you" || ui.busy) return;
    if (g.phase !== "main" && g.phase !== "attack") return;
    var card = g.you.board[boardIdx];
    if (!card || !card.canAttack || card.exhausted) {
      setStatus("That unit cannot attack yet (needs Rush, or wait until next turn).", true);
      return;
    }
    // Click same unit again → cancel direct attack selection
    if (ui.selectedBoard === boardIdx) {
      cancelAttackSelect();
      return;
    }
    g.phase = "attack";
    ui.selectedBoard = boardIdx;
    clearFusionSelect();
    var heldNote = isAttackHeld(boardIdx)
      ? " (held from Attack All — directed strike still OK)"
      : "";
    if (livingBoard(g.enemy).length) {
      setStatus(
        "Direct attack" +
          heldNote +
          ": click a red/IN RANGE enemy unit. Click " +
          card.name +
          " again to cancel. Shift+click to hold/unhold from Attack All."
      );
    } else {
      setStatus(
        "Direct attack" +
          heldNote +
          ": field clear — click Enemy hero or Strike hero. Click " +
          card.name +
          " again to cancel."
      );
    }
    render();
  }

  function resolveAttack(game, atkOwner, atkIdx, defOwner, defIdx) {
    var atkSide = atkOwner === "you" ? game.you : game.enemy;
    var defSide = defOwner === "you" ? game.you : game.enemy;
    var attacker = atkSide.board[atkIdx];
    if (!attacker || !attacker.canAttack || attacker.exhausted) return false;

    if (defIdx === "face" || defIdx === "hero") {
      if (livingBoard(defSide).length) {
        if (atkOwner === "you") {
          setStatus(
            "Hero is shielded by units — destroy every enemy field card first.",
            true
          );
        }
        return false;
      }
      defSide.hp = Math.max(0, defSide.hp - attacker.atk);
      if (attacker.effect === "lifesteal") {
        atkSide.hp = Math.min(PLAYER_HP, atkSide.hp + attacker.atk);
      }
      log(
        game,
        attacker.name +
          " strikes the hero (" +
          (defOwner === "you" ? "you" : defSide.name) +
          ") for " +
          attacker.atk +
          "."
      );
      attacker.canAttack = false;
      attacker.exhausted = true;
      checkWinner(game);
      return true;
    }

    var defender = defSide.board[defIdx];
    if (!defender) return false;
    if (hasTaunt(defSide) && defender.effect !== "taunt") {
      if (atkOwner === "you") setStatus("Must attack a Taunt unit first.", true);
      return false;
    }

    dealDamageToCard(game, defender, attacker.atk, attacker, atkOwner);
    log(game, attacker.name + " strikes " + defender.name + " for " + attacker.atk + ".");
    // Counterstrike
    dealDamageToCard(game, attacker, defender.atk, defender, defOwner);
    if (attacker.effect === "pierce" && defender.hp < 0) {
      var over = -defender.hp;
      if (over > 0) {
        defSide.hp = Math.max(0, defSide.hp - over);
        log(game, "Pierce overflows " + over + " to the hero.");
      }
    }
    attacker.canAttack = false;
    attacker.exhausted = true;
    removeDead(game, atkSide);
    removeDead(game, defSide);
    checkWinner(game);
    return true;
  }

  function playStrikeAnim(atkOwner, atkIdx, defOwner, defIdx) {
    ui.anim = {
      type: "strike",
      fromOwner: atkOwner,
      fromIdx: atkIdx,
      toOwner: defOwner,
      toIdx: defIdx,
    };
    render();
    return delay(520).then(function () {
      ui.anim = null;
    });
  }

  /**
   * Weave FX: orbit in a circle → collapse into one slot → loading shell
   * while new art generates (loading phase stays until clearFuseAnim).
   */
  function playFusionAnim(owner, idxs) {
    idxs = (idxs || []).slice().sort(function (a, b) {
      return a - b;
    });
    var mergeIdx = idxs[0];
    ui.anim = {
      type: "fuse",
      owner: owner,
      idxs: idxs,
      phase: "orbit",
      mergeIdx: mergeIdx,
      n: idxs.length,
    };
    render();
    return delay(1500)
      .then(function () {
        ui.anim = {
          type: "fuse",
          owner: owner,
          idxs: idxs,
          phase: "merge",
          mergeIdx: mergeIdx,
          n: idxs.length,
        };
        render();
        return delay(750);
      })
      .then(function () {
        ui.anim = {
          type: "fuse",
          owner: owner,
          idxs: idxs,
          phase: "loading",
          mergeIdx: mergeIdx,
          n: idxs.length,
        };
        render();
        return delay(200);
      });
  }

  function setFuseLoadingStatus(msg) {
    if (ui.anim && ui.anim.type === "fuse" && ui.anim.phase === "loading") {
      ui.anim.loadingMsg = msg || "Generating art…";
      render();
    }
    setStatus(msg || "Generating brand-new card art…");
  }

  function clearFuseAnim() {
    if (ui.anim && ui.anim.type === "fuse") ui.anim = null;
  }

  function attackAllReady(game, owner) {
    var atkSide = owner === "you" ? game.you : game.enemy;
    var defSide = owner === "you" ? game.enemy : game.you;
    var defOwner = owner === "you" ? "enemy" : "you";
    var plan = [];
    var skippedHeld = 0;
    for (var i = 0; i < MAX_BOARD; i++) {
      var atk = atkSide.board[i];
      if (!atk || !atk.canAttack || atk.exhausted) continue;
      // Player may hold units back from the mass swing (still free to direct-attack)
      if (owner === "you" && isAttackHeld(i)) {
        skippedHeld++;
        continue;
      }
      var units = [];
      for (var j = 0; j < MAX_BOARD; j++) {
        if (defSide.board[j]) units.push(j);
      }
      if (units.length) {
        var taunts = units.filter(function (j) {
          return defSide.board[j].effect === "taunt";
        });
        var poolIdx = taunts.length ? taunts : units;
        poolIdx.sort(function (a, b) {
          return defSide.board[a].hp - defSide.board[b].hp;
        });
        plan.push({ i: i, target: poolIdx[0] });
      } else {
        plan.push({ i: i, target: "hero" });
      }
    }
    if (!plan.length) {
      if (skippedHeld > 0 && owner === "you") {
        setStatus(
          "All ready units are held — direct-attack chosen targets, or Shift+click to unhold.",
          true
        );
      }
      return Promise.resolve(false);
    }
    if (skippedHeld > 0 && owner === "you") {
      log(
        game,
        "Attack All: " +
          plan.length +
          " swing" +
          (plan.length === 1 ? "" : "s") +
          ", " +
          skippedHeld +
          " held back."
      );
    }

    ui.busy = true;
    ui.selectedBoard = null;
    var chain = Promise.resolve();
    plan.forEach(function (step) {
      chain = chain.then(function () {
        if (game.phase === "ended") return;
        var still = atkSide.board[step.i];
        if (!still || !still.canAttack || still.exhausted) return;
        if (owner === "you" && isAttackHeld(step.i)) return;
        // re-evaluate target if board changed
        var target = step.target;
        if (target !== "hero") {
          if (!defSide.board[target]) {
            var units2 = [];
            for (var j2 = 0; j2 < MAX_BOARD; j2++) {
              if (defSide.board[j2]) units2.push(j2);
            }
            if (!units2.length) target = "hero";
            else {
              var taunts2 = units2.filter(function (j) {
                return defSide.board[j].effect === "taunt";
              });
              target = (taunts2.length ? taunts2 : units2)[0];
            }
          }
        } else if (livingBoard(defSide).length) {
          return;
        }
        return playStrikeAnim(owner, step.i, defOwner, target).then(function () {
          resolveAttack(game, owner, step.i, defOwner, target);
          render();
          return delay(280);
        });
      });
    });
    return chain.then(function () {
      ui.busy = false;
      ui.anim = null;
      render();
      return true;
    });
  }

  function endTurn(game) {
    if (game.phase === "ended" || ui.busy) return;
    if (game.turnOf === "you") {
      log(game, "You end your turn.");
      startTurn(game, "enemy");
      render();
      pushLanIfNeeded();
      if (game.enemy.isCpu) {
        setTimeout(function () {
          runCpuTurn(game);
        }, 650);
      }
    } else {
      log(game, game.enemy.name + " ends turn.");
      startTurn(game, "you");
      render();
      pushLanIfNeeded();
    }
  }

  function runCpuTurn(game) {
    if (!game || game.phase === "ended" || game.turnOf !== "enemy") return;
    ui.busy = true;
    setStatus(game.enemy.name + " is thinking…");

    function playOneCard() {
      if (game.phase === "ended") return Promise.resolve();
      var slot = freeBoardSlot(game.enemy);
      if (slot < 0) return Promise.resolve();
      var best = -1;
      var bestCost = -1;
      for (var i = 0; i < game.enemy.hand.length; i++) {
        var c = game.enemy.hand[i];
        if (c.cost <= game.enemy.mana && c.cost >= bestCost) {
          bestCost = c.cost;
          best = i;
        }
      }
      if (best < 0) return Promise.resolve();
      var card = game.enemy.hand.splice(best, 1)[0];
      game.enemy.mana -= card.cost;
      var unit = cloneCard(card);
      unit.canAttack = unit.effect === "rush";
      unit.exhausted = !unit.canAttack;
      game.enemy.board[slot] = unit;
      log(game, game.enemy.name + " plays " + unit.name + ".");
      var fx = EFFECTS[unit.effect];
      if (fx && fx.onPlay) fx.onPlay(unit, game, "enemy");
      render();
      if (checkWinner(game)) return Promise.resolve();
      return delay(480).then(playOneCard);
    }

    playOneCard()
      .then(function () {
        if (game.phase === "ended") return;
        var idxs = [];
        for (var b = 0; b < MAX_BOARD; b++) {
          if (game.enemy.board[b]) idxs.push(b);
        }
        var wantFuse =
          canUseWeaveCredits() &&
          idxs.length >= 2 &&
          (Math.random() < 0.4 ||
            (game.enemy.hp <= 16 && Math.random() < 0.6) ||
            (idxs.length >= 3 && Math.random() < 0.55));
        if (wantFuse) {
          idxs.sort(function (i, j) {
            var A = game.enemy.board[i];
            var B = game.enemy.board[j];
            return B.atk + B.hp - (A.atk + A.hp);
          });
          var nFuse = FUSE_MIN + Math.floor(Math.random() * (Math.min(FUSE_MAX, idxs.length) - FUSE_MIN + 1));
          nFuse = Math.max(FUSE_MIN, Math.min(nFuse, idxs.length, FUSE_MAX));
          var pick = idxs.slice(0, nFuse);
          var cards = pick.map(function (i) {
            return game.enemy.board[i];
          });
          var prompt = inventCpuFusionPrompt(cards);
          log(
            game,
            game.enemy.name +
              " invents a " +
              nFuse +
              "-card weave: “" +
              prompt.slice(0, 72) +
              "…”"
          );
          setStatus(game.enemy.name + " weaves " + nFuse + " units…");
          return fuseUnits(game, "enemy", pick, prompt, true)
            .then(function () {
              return delay(500);
            })
            .catch(function () {
              // Brand-new art failed — still take an attack wave
              log(game, game.enemy.name + " weave failed; attacking instead.");
              return attackAllReady(game, "enemy");
            });
        }
        return attackAllReady(game, "enemy");
      })
      .then(function () {
        ui.busy = false;
        if (game.phase !== "ended") {
          startTurn(game, "you");
        }
        setStatus("");
        render();
        pushLanIfNeeded();
      })
      .catch(function () {
        ui.busy = false;
        if (game.phase !== "ended") startTurn(game, "you");
        render();
      });
  }

  function fuseUnits(game, owner, indices, promptText, skipEndTurn) {
    var side = owner === "you" ? game.you : game.enemy;
    // Support legacy 2-arg form: fuseUnits(g, owner, i, j, prompt, skip)
    if (typeof indices === "number" && typeof promptText === "number") {
      var legacyB = promptText;
      promptText = skipEndTurn;
      skipEndTurn = arguments[5];
      indices = [indices, legacyB];
    }
    var idxs = (Array.isArray(indices) ? indices : [indices])
      .map(function (i) {
        return parseInt(i, 10);
      })
      .filter(function (i, pos, arr) {
        return (
          !isNaN(i) &&
          i >= 0 &&
          i < MAX_BOARD &&
          side.board[i] &&
          arr.indexOf(i) === pos
        );
      });
    if (idxs.length < FUSE_MIN || idxs.length > FUSE_MAX) {
      return Promise.reject(
        new Error("Select " + FUSE_MIN + "–" + FUSE_MAX + " different units to weave.")
      );
    }
    if (!canUseWeaveCredits()) {
      var noCred =
        "No API credits — weave disabled. Units stay on the field (no retries).";
      setStatus(noCred, true);
      log(game, noCred);
      updateWeaveCreditsUi();
      return Promise.reject(new Error(noCred));
    }
    var cards = idxs.map(function (i) {
      return side.board[i];
    });
    var a = cards[0];
    var b = cards[1] || cards[0];

    var cost = 1;
    var atk = 0;
    var hp = 0;
    var seed = 0;
    cards.forEach(function (c) {
      cost = Math.max(cost, c.cost);
      atk += c.atk;
      hp += c.hp;
      seed += (c.effect || "").length + c.atk;
    });
    cost = Math.min(7, cost + Math.floor((cards.length - 1) / 2));
    atk = Math.min(12, Math.ceil(atk * (0.55 + cards.length * 0.08)) + 1);
    hp = Math.min(14, Math.ceil(hp * (0.5 + cards.length * 0.07)) + 1);
    var effect = EFFECT_KEYS[Math.abs(seed) % EFFECT_KEYS.length];
    var fusedName = inventFusedTitle(cards, promptText);
    var inspired = cards
      .map(function (c) {
        return "“" + c.name + "”";
      })
      .join(", ");
    var stasis =
      "Brand-new never-before-seen fine-art still for a trading card. " +
      "Invent a completely original composition — do not recreate, remix, or collage any existing gallery painting. " +
      "Single hero subject. Motif DNA only from: " +
      inspired +
      ". " +
      String(promptText || "").slice(0, 220) +
      " Painterly, dramatic light, no text, no logos, no watermarks.";

    function parentUrls() {
      return cards.map(function (c) {
        return resolveUrl(c.url || "");
      });
    }

    function isBrandNewUrl(url) {
      var abs = resolveUrl(url);
      if (!abs) return false;
      // Must not reuse any source card image
      var parents = parentUrls();
      for (var i = 0; i < parents.length; i++) {
        if (parents[i] && abs === parents[i]) return false;
      }
      return true;
    }

    function extractImageUrl(payload) {
      if (!payload) return "";
      var img = payload.image;
      var raw =
        (img && (img.url || img.download_url || img.uri)) ||
        payload.url ||
        payload.image_url ||
        payload.output_url ||
        payload.result_url ||
        (payload.result && (payload.result.url || payload.result.image_url)) ||
        "";
      return resolveUrl(raw);
    }

    function saveNewToGallery(url) {
      var abs = resolveUrl(url);
      var payload = {
        image_url: abs,
        source: "cardduel-fusion",
        collection: "generated",
        description: String(fusedName + " — " + (promptText || "woven duel card")).slice(
          0,
          200
        ),
        meta: {
          source: "cardduel-fusion",
          title: fusedName,
          prompt: String(promptText || stasis).slice(0, 500),
          woven_from: cards.map(function (c) {
            return c.name;
          }),
        },
      };
      if (String(url).indexOf("data:") === 0) {
        payload.image_base64 = url;
        delete payload.image_url;
      }
      return fetch(apiUrl("/api/save-generated-image"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, d: d || {} };
          });
        })
        .then(function (res) {
          var d = res.d || {};
          var saved = d.url || (d.record && d.record.url) || abs;
          var num =
            d.num != null
              ? d.num
              : d.record && d.record.num != null
                ? d.record.num
                : null;
          return { url: resolveUrl(saved), num: num };
        })
        .catch(function () {
          // Still accept the generated URL even if save fails
          return { url: abs, num: null };
        });
    }

    function finishWithNewArt(url, fileNum) {
      if (!isBrandNewUrl(url)) {
        throw new Error("Weave must produce new art — refused reused image.");
      }
      var fused = {
        id: uid(),
        name: fusedName,
        kind: "woven",
        fileNum: fileNum != null ? fileNum : null,
        num: fileNum != null ? fileNum : null,
        url: resolveUrl(url),
        cost: cost,
        atk: atk,
        hp: hp,
        maxHp: hp,
        effect: effect,
        canAttack: false,
        shield: effect === "shield",
        exhausted: true,
        fusion: true,
      };
      idxs.forEach(function (i) {
        side.board[i] = null;
      });
      var slot = freeBoardSlot(side);
      if (slot < 0) slot = idxs[0];
      side.board[slot] = fused;
      // Add to pool so future decks can draw this new art
      try {
        pool.generated.push({
          kind: "generated",
          num: fused.num,
          title: fused.name,
          url: fused.url,
        });
      } catch (ePool) {}
      log(
        game,
        (owner === "you" ? "You weave" : side.name + " weaves") +
          " " +
          cards.length +
          " → new card “" +
          fused.name +
          "” (" +
          fused.atk +
          "/" +
          fused.hp +
          ") · " +
          (EFFECTS[effect] ? EFFECTS[effect].name : effect) +
          (fused.num != null ? " · saved G#" + fused.num : "")
      );
      var fx = EFFECTS[fused.effect];
      if (fx && fx.onPlay && fused.effect !== "rush") {
        if (
          fused.effect === "draw" ||
          fused.effect === "heal" ||
          fused.effect === "burn" ||
          fused.effect === "buff"
        ) {
          fx.onPlay(fused, game, owner);
        }
      }
      clearFusionSelect();
      ui.selectedBoard = null;
      ui.busy = false;
      // Brief reveal flash on the new woven card
      ui.anim = {
        type: "fuse",
        owner: owner,
        idxs: [slot],
        phase: "reveal",
        mergeIdx: slot,
        n: 1,
      };
      render();
      return delay(650).then(function () {
        clearFuseAnim();
        if (!skipEndTurn && owner === "you") {
          log(game, "Weaving ends your turn.");
          startTurn(game, "enemy");
          render();
          pushLanIfNeeded();
          if (game.enemy.isCpu) {
            setTimeout(function () {
              runCpuTurn(game);
            }, 700);
          }
        } else {
          render();
          pushLanIfNeeded();
        }
        setStatus("New card “" + fused.name + "” enters the field.");
        return fused;
      });
    }

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "cd-" + Date.now();

    // Confirm credits first (no anim / no API if empty), then weave once — no retry loop
    return ensureCreditsForWeave()
      .then(function () {
        ui.busy = true;
        setStatus(
          "Weaving " +
            cards.length +
            ": " +
            cards
              .map(function (c) {
                return c.name;
              })
              .join(", ") +
            "…"
        );
        game.phase = "fusion";
        return playFusionAnim(owner, idxs);
      })
      .then(function () {
        setFuseLoadingStatus("Generating brand-new card art…");
        return fetch(apiUrl("/api/generate-stasis-vision"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: jobId,
            stasis: stasis,
            prompt: stasis,
            buzz_words: [
              "original painting",
              "brand new",
              "never seen before",
              "trading card portrait",
              "single subject",
            ],
            spells: [],
            aspect_ratio: "2:3",
            mag_fresh: true,
            fresh_variation: true,
            spell_cast: false,
            source: "cardduel-fusion",
            product_mode: "original_fusion",
          }),
        });
      })
      .then(function (r) {
        return r
          .json()
          .then(function (d) {
            return { ok: r.ok, status: r.status, d: d || {} };
          })
          .catch(function () {
            return {
              ok: r.ok,
              status: r.status,
              d: { error: "Invalid response from generate" },
            };
          });
      })
      .then(function (res) {
        var d = res.d || {};
        var errMsg = (d && (d.error || d.message || d.detail)) || "";
        if (!res.ok || isCreditsError(errMsg)) {
          if (isCreditsError(errMsg) || res.status === 402 || res.status === 429) {
            markCreditsBlocked();
            throw new Error(
              errMsg || "Out of xAI credits — weave disabled."
            );
          }
        }
        var url = extractImageUrl(d);
        if (res.status === 202 || (!url && (d.job_id || jobId))) {
          setFuseLoadingStatus("New card art rendering…");
          return pollFusionJob(d.job_id || jobId, 90);
        }
        if (!res.ok) {
          throw new Error(errMsg || "Weave generation failed");
        }
        if (!url) throw new Error("No new image URL from generate");
        return resolveUrl(url);
      })
      .then(function (url) {
        if (!isBrandNewUrl(url)) {
          throw new Error("Server returned existing art — weave requires a new still");
        }
        setFuseLoadingStatus("Saving new card to Generated…");
        return saveNewToGallery(url);
      })
      .then(function (saved) {
        if (!saved || !isBrandNewUrl(saved.url)) {
          throw new Error("Could not save a new generated still");
        }
        return finishWithNewArt(saved.url, saved.num);
      })
      .catch(function (err) {
        var raw = (err && err.message) || "Generation failed";
        var credits = isCreditsError(raw) || ui.creditsBlocked;
        if (credits) markCreditsBlocked();
        var msg = credits
          ? "Out of credits — weave disabled (not retrying). Units stay on the field. Add credits, then refresh the credits HUD."
          : "Weave needs a brand-new generated still. " +
            raw +
            " — units stay on the field.";
        // Do NOT place a card using parent art; do NOT retry
        ui.busy = false;
        clearFuseAnim();
        game.phase = "main";
        setStatus(msg, true);
        log(game, msg);
        render();
        // Re-throw so CPU can fall back to attacking (once)
        return Promise.reject(err);
      });
  }

  function pollFusionJob(jobId, left) {
    left = left == null ? 90 : left;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for new card art"));
    // Stop polling if credits ran out mid-job (no thrash / no retry loop)
    if (ui.creditsBlocked) {
      return Promise.reject(new Error("Out of xAI credits — weave disabled."));
    }
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId) + "?t=" + Date.now()), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().then(function (job) {
          return { ok: r.ok, status: r.status, job: job || {} };
        });
      })
      .then(function (res) {
        var job = res.job || {};
        var errMsg =
          job.error ||
          job.message ||
          job.detail ||
          (job.error && (job.error.message || job.error)) ||
          "";
        if (typeof errMsg !== "string") errMsg = String(errMsg || "");
        if (
          isCreditsError(errMsg) ||
          res.status === 402 ||
          res.status === 429
        ) {
          markCreditsBlocked();
          return Promise.reject(
            new Error(errMsg || "Out of xAI credits — weave disabled.")
          );
        }
        if (!res.ok) {
          return Promise.reject(new Error(errMsg || "Job request failed"));
        }
        var st = String((job && job.status) || "").toLowerCase();
        if (st === "error" || st === "failed" || st === "failure" || st === "expired") {
          var failMsg = errMsg || "Weave job failed";
          if (isCreditsError(failMsg)) markCreditsBlocked();
          return Promise.reject(new Error(failMsg));
        }
        if (st === "done" || st === "completed" || st === "success") {
          var url =
            (job.image && (job.image.url || job.image)) ||
            job.url ||
            job.image_url ||
            job.output_url ||
            job.result_url ||
            "";
          if (!url) throw new Error("Job done but no image URL");
          return resolveUrl(url);
        }
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            pollFusionJob(jobId, left - 1).then(resolve, reject);
          }, 1500);
        });
      });
  }

  function newGame(mode, enemyName) {
    lan.mode = mode || "cpu";
    g = {
      turn: 1,
      turnOf: "you",
      phase: "main",
      winner: null,
      logLines: [],
      you: makeSide("You", false),
      enemy: makeSide(enemyName || (mode === "lan" ? "Rival" : "CPU"), mode !== "lan"),
      attacksLeft: true,
      firstPlayer: null,
    };
    // Opening hands
    for (var i = 0; i < HAND_SIZE; i++) {
      drawOne(g, g.you, "You");
      drawOne(g, g.enemy, g.enemy.name);
    }
    g.you.maxMana = 0;
    g.enemy.maxMana = 0;

    // Fair coin toss — either side can open
    var youFirst = Math.random() < 0.5;
    var first = youFirst ? "you" : "enemy";
    g.firstPlayer = first;
    var tossLine = youFirst
      ? "Coin toss: heads — you go first."
      : "Coin toss: tails — " + g.enemy.name + " goes first.";
    log(g, "—— " + tossLine + " ——");
    startTurn(g, first);

    var base =
      mode === "lan"
        ? "LAN duel ready."
        : "Duel vs CPU — play cards, attack, or fuse.";
    setStatus(base + " " + tossLine);
    render();

    if (first === "enemy" && g.enemy.isCpu) {
      ui.busy = true;
      setTimeout(function () {
        if (g && g.turnOf === "enemy" && g.phase !== "ended") {
          runCpuTurn(g);
        } else {
          ui.busy = false;
          render();
        }
      }, 700);
    }
  }

  /* —— UI —— */
  function setStatus(msg, isErr) {
    var el = $("cd-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", !!isErr);
  }

  function effectLabel(key) {
    var e = EFFECTS[key];
    return e ? e.name + " — " + e.desc : key || "—";
  }

  function sortHandCards(hand) {
    var list = hand.slice();
    var mode = ui.handSort || "mana";
    list.sort(function (a, b) {
      var d = 0;
      if (mode === "mana") d = a.cost - b.cost;
      else if (mode === "atk") d = b.atk - a.atk;
      else if (mode === "hp") d = b.hp - a.hp;
      else if (mode === "name") d = String(a.name).localeCompare(String(b.name));
      if (d !== 0) return d;
      return String(a.name).localeCompare(String(b.name));
    });
    return list;
  }

  function renderEffectLegend() {
    var el = $("cd-effect-legend");
    if (!el) return;
    el.innerHTML = "";
    EFFECT_KEYS.forEach(function (key) {
      var e = EFFECTS[key];
      if (!e) return;
      var row = document.createElement("div");
      row.className = "cd-effect-row";
      row.innerHTML =
        "<strong>" +
        escapeHtml(e.name) +
        "</strong> <span>" +
        escapeHtml(e.desc) +
        "</span>";
      el.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cardButton(card, opts) {
    opts = opts || {};
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cd-card" + (opts.selected ? " is-selected" : "");
    if (card.fusion) btn.className += " is-woven";
    if (opts.attacking) btn.className += " is-attacking";
    if (opts.readyAttack) btn.className += " is-ready-attack";
    if (opts.attackHeld) btn.className += " is-attack-held";
    if (opts.legalTarget) btn.className += " is-legal-target";
    if (opts.hit) btn.className += " is-hit";
    if (opts.fuseGlow) btn.className += " is-fuse-glow";
    if (opts.fuseOrbit) btn.className += " is-fuse-orbit";
    if (opts.fuseMerge) btn.className += " is-fuse-merge";
    if (opts.fuseLoading) btn.className += " is-fuse-loading";
    if (opts.fuseReveal) btn.className += " is-fuse-reveal";
    if (opts.fuseHidden) btn.className += " is-fuse-hidden";
    if (opts.disabled) btn.disabled = true;
    if (opts.fuseOrbit || opts.fuseMerge) {
      btn.style.setProperty("--fuse-i", String(opts.fuseIndex || 0));
      btn.style.setProperty("--fuse-n", String(opts.fuseCount || 1));
      btn.style.setProperty(
        "--fuse-angle",
        String((360 / Math.max(1, opts.fuseCount || 1)) * (opts.fuseIndex || 0))
      );
      if (opts.fuseMergeDx != null) {
        btn.style.setProperty("--fuse-dx", opts.fuseMergeDx * 8.2 + "rem");
      }
    }
    btn.dataset.cardId = card.id || "";
    var tip = card.name + " · " + effectLabel(card.effect);
    if (opts.attackHeld) tip += " · HELD from Attack All — click to direct-attack · Shift+click to unhold";
    else if (opts.readyAttack) tip += " · CAN ATTACK — click to choose target · Shift+click to hold from Attack All";
    if (opts.legalTarget) tip += " · LEGAL TARGET — click to strike";
    btn.title = tip;
    var cost = document.createElement("span");
    cost.className = "cd-card-cost";
    cost.title = "Mana cost";
    cost.textContent = String(card.cost);
    var img = document.createElement("img");
    img.className = "cd-card-art";
    img.alt = card.name || "";
    img.loading = "lazy";
    img.draggable = false;
    if (card.url) img.src = card.url;
    var frame = document.createElement("div");
    frame.className = "cd-card-frame";
    var body = document.createElement("div");
    body.className = "cd-card-body";
    var name = document.createElement("span");
    name.className = "cd-card-name";
    name.textContent = card.name;
    var stats = document.createElement("div");
    stats.className = "cd-card-stats";
    stats.innerHTML =
      '<span class="cd-card-atk" title="Attack power">' +
      card.atk +
      '</span><span class="cd-card-hp" title="Health">' +
      card.hp +
      (card.shield ? " ◆" : "") +
      "</span>";
    var fx = document.createElement("span");
    fx.className = "cd-card-effect";
    var e = EFFECTS[card.effect];
    fx.textContent = e ? e.name : "";
    fx.title = e ? e.desc : "";
    var fxDesc = document.createElement("span");
    fxDesc.className = "cd-card-effect-desc";
    fxDesc.textContent = e ? e.desc : "";
    body.appendChild(name);
    body.appendChild(stats);
    body.appendChild(fx);
    body.appendChild(fxDesc);
    btn.appendChild(cost);
    btn.appendChild(img);
    btn.appendChild(frame);
    btn.appendChild(body);
    if (opts.attackHeld) {
      var hbadge = document.createElement("span");
      hbadge.className = "cd-badge cd-badge-held";
      hbadge.textContent = "HELD";
      btn.appendChild(hbadge);
    } else if (opts.readyAttack) {
      var badge = document.createElement("span");
      badge.className = "cd-badge cd-badge-ready";
      badge.textContent = "CAN ATTACK";
      btn.appendChild(badge);
    }
    if (opts.legalTarget) {
      var tbadge = document.createElement("span");
      tbadge.className =
        "cd-badge cd-badge-target" +
        (opts.softTarget ? " is-soft" : "");
      tbadge.textContent = opts.softTarget ? "IN RANGE" : "TARGET";
      btn.appendChild(tbadge);
    }
    if (opts.fuseLoading) {
      // Replace art with loading shell
      img.removeAttribute("src");
      img.alt = "Loading new art";
      img.className = "cd-card-art is-loading-art";
      var loadShell = document.createElement("div");
      loadShell.className = "cd-fuse-load-overlay";
      loadShell.innerHTML =
        '<span class="cd-fuse-spinner" aria-hidden="true"></span>' +
        '<span class="cd-fuse-load-text">' +
        escapeHtml(opts.loadingMsg || "Weaving art…") +
        "</span>";
      btn.appendChild(loadShell);
      name.textContent = opts.loadingTitle || "Weaving…";
    }
    if (opts.onClick) btn.addEventListener("click", opts.onClick);
    return btn;
  }

  function animFlagsFor(owner, idx) {
    var a = ui.anim;
    if (!a) return {};
    if (a.type === "strike") {
      return {
        attacking: a.fromOwner === owner && a.fromIdx === idx,
        hit:
          a.toOwner === owner &&
          a.toIdx === idx &&
          a.toIdx !== "hero" &&
          a.toIdx !== "face",
      };
    }
    if (a.type === "fuse" || a.type === "fuse-burst") {
      if (a.owner !== owner) return {};
      var list = (a.idxs || []).slice();
      if (a.idxA != null) list = list.concat([a.idxA, a.idxB]);
      var pos = list.indexOf(idx);
      var phase = a.phase || "orbit";
      if (pos < 0 && phase === "reveal" && a.mergeIdx === idx) {
        return { fuseReveal: true };
      }
      if (pos < 0) return {};
      if (phase === "orbit") {
        return {
          fuseGlow: true,
          fuseOrbit: true,
          fuseIndex: pos,
          fuseCount: list.length,
        };
      }
      if (phase === "merge") {
        return {
          fuseGlow: true,
          fuseMerge: true,
          fuseIndex: pos,
          fuseCount: list.length,
          fuseMergeTarget: a.mergeIdx != null ? a.mergeIdx : list[0],
          fuseMergeDx: (a.mergeIdx != null ? a.mergeIdx : list[0]) - idx,
        };
      }
      if (phase === "loading") {
        if (idx === a.mergeIdx) {
          return {
            fuseLoading: true,
            loadingMsg: a.loadingMsg || "Generating art…",
          };
        }
        // Other woven units vanish into the merge slot
        return { fuseHidden: true };
      }
      if (phase === "reveal") {
        return { fuseReveal: true };
      }
      return { fuseGlow: true };
    }
    return {};
  }

  function renderBoardRow(slotsEl, side, owner) {
    if (!slotsEl) return;
    slotsEl.innerHTML = "";
    var yourTurn = g && g.turnOf === "you" && g.phase !== "ended" && !ui.busy;
    var fuseMode = $("cd-fusion-mode") && $("cd-fusion-mode").checked;
    var info = g ? getAttackTargetInfo(g) : null;
    var attackMode =
      yourTurn && !fuseMode && ui.fusionSelected.length === 0;
    var hasSelected = attackMode && ui.selectedBoard != null;

    for (var i = 0; i < MAX_BOARD; i++) {
      var slot = document.createElement("div");
      slot.className = "cd-slot";
      var card = side.board[i];
      var isEnemy = owner === "enemy";
      var ready =
        attackMode &&
        !isEnemy &&
        isReadyAttacker(card);
      var legalTarget = false;
      var softTarget = false;
      if (attackMode && isEnemy && card && info && info.ready > 0) {
        var mustTaunt = info.hasTaunt;
        if (!mustTaunt || card.effect === "taunt") {
          if (hasSelected) legalTarget = true;
          else softTarget = true;
        }
      }
      if (softTarget) slot.classList.add("is-soft-target");
      if (legalTarget) slot.classList.add("is-targetable");
      if (ready) slot.classList.add("is-ready-slot");
      if (
        g &&
        g.turnOf === "you" &&
        !isEnemy &&
        (ui.selectedBoard === i || isFusionSelected(i))
      ) {
        slot.classList.add("is-selected");
      }
      if (card) {
        (function (idx, c, own, soft) {
          var af = animFlagsFor(own, idx);
          var readyHere =
            attackMode && own === "you" && isReadyAttacker(c);
          var heldHere = readyHere && isAttackHeld(idx);
          var legalHere = false;
          var softHere = false;
          if (attackMode && own === "enemy" && info && info.ready > 0) {
            var mt = info.hasTaunt;
            if (!mt || c.effect === "taunt") {
              if (hasSelected) legalHere = true;
              else softHere = true;
            }
          }
          if (heldHere) slot.classList.add("is-held-slot");
          if (af.fuseOrbit || af.fuseMerge) {
            slot.classList.add("is-fuse-active");
            slot.style.setProperty("--fuse-i", String(af.fuseIndex || 0));
            slot.style.setProperty("--fuse-n", String(af.fuseCount || 1));
            slot.style.setProperty(
              "--fuse-angle",
              String(
                (360 / Math.max(1, af.fuseCount || 1)) * (af.fuseIndex || 0)
              )
            );
            if (af.fuseMergeDx != null) {
              slot.style.setProperty(
                "--fuse-dx",
                af.fuseMergeDx * 8.2 + "rem"
              );
            }
          }
          if (af.fuseLoading) slot.classList.add("is-fuse-loading-slot");
          if (af.fuseHidden) slot.classList.add("is-fuse-hidden-slot");
          if (af.fuseReveal) slot.classList.add("is-fuse-reveal-slot");
          slot.appendChild(
            cardButton(c, {
              selected:
                !isEnemy && (ui.selectedBoard === idx || isFusionSelected(idx)),
              attacking:
                af.attacking ||
                (!isEnemy && ui.selectedBoard === idx && g.phase === "attack"),
              readyAttack:
                readyHere &&
                !heldHere &&
                !af.fuseOrbit &&
                !af.fuseMerge &&
                !af.fuseLoading,
              attackHeld: heldHere && !af.fuseOrbit && !af.fuseMerge,
              legalTarget: legalHere || softHere,
              softTarget: softHere,
              hit: af.hit,
              fuseGlow: af.fuseGlow,
              fuseOrbit: af.fuseOrbit,
              fuseMerge: af.fuseMerge,
              fuseLoading: af.fuseLoading,
              fuseReveal: af.fuseReveal,
              fuseHidden: af.fuseHidden,
              fuseIndex: af.fuseIndex,
              fuseCount: af.fuseCount,
              fuseMergeDx: af.fuseMergeDx,
              loadingMsg: af.loadingMsg,
              loadingTitle: af.fuseLoading ? "Weaving…" : null,
              onClick: function (ev) {
                onBoardClick(own, idx, ev);
              },
            })
          );
        })(i, card, owner, softTarget);
      }
      slotsEl.appendChild(slot);
    }
  }

  function updateHeroTargets() {
    var enemyHero = $("cd-enemy-hero");
    var youHero = $("cd-you-hero");
    var strikeBtn = $("cd-attack-face");
    var info = g ? getAttackTargetInfo(g) : null;
    var hasSelected =
      g && g.turnOf === "you" && ui.selectedBoard != null && !ui.busy;
    var canStrikeHero =
      hasSelected && info && info.heroOpen && isReadyAttacker(g.you.board[ui.selectedBoard]);
    // Soft pulse when field empty and you have any ready attacker
    var softHero =
      g &&
      g.turnOf === "you" &&
      !ui.busy &&
      info &&
      info.heroOpen &&
      info.ready > 0;

    if (enemyHero) {
      enemyHero.classList.toggle("is-targetable", !!canStrikeHero);
      enemyHero.classList.toggle("is-soft-target", !!(softHero && !canStrikeHero));
      enemyHero.classList.toggle(
        "is-hit",
        !!(
          ui.anim &&
          ui.anim.type === "strike" &&
          ui.anim.toOwner === "enemy" &&
          (ui.anim.toIdx === "hero" || ui.anim.toIdx === "face")
        )
      );
      // OPEN / TARGET badge on enemy hero portrait
      var heroBadge = enemyHero.querySelector(".cd-hero-attack-badge");
      if (!heroBadge) {
        heroBadge = document.createElement("span");
        heroBadge.className = "cd-hero-attack-badge";
        enemyHero.appendChild(heroBadge);
      }
      if (canStrikeHero) {
        heroBadge.hidden = false;
        heroBadge.className = "cd-hero-attack-badge is-hot";
        heroBadge.textContent = "STRIKE NOW";
        enemyHero.title = "LEGAL TARGET — click to strike the enemy hero";
      } else if (softHero) {
        heroBadge.hidden = false;
        heroBadge.className = "cd-hero-attack-badge is-open";
        heroBadge.textContent = "OPEN";
        enemyHero.title =
          "Field empty — select a ready attacker, then click here to strike";
      } else if (info && info.ready > 0 && !info.heroOpen) {
        heroBadge.hidden = false;
        heroBadge.className = "cd-hero-attack-badge is-blocked";
        heroBadge.textContent = "BLOCKED";
        enemyHero.title =
          "Blocked by field units: " + (info.unitNames.join(", ") || "units");
      } else {
        heroBadge.hidden = true;
        heroBadge.textContent = "";
        enemyHero.title = "Enemy hero";
      }
    }
    if (strikeBtn) {
      strikeBtn.disabled = !canStrikeHero;
      strikeBtn.classList.toggle("is-lit", !!canStrikeHero);
      strikeBtn.title = canStrikeHero
        ? "Strike the enemy hero with your selected unit"
        : info && info.ready > 0 && !info.heroOpen
          ? "Clear enemy field units first"
          : "Select a ready attacker first (when the field is empty)";
    }
    if (youHero) {
      youHero.classList.remove("is-targetable");
      youHero.classList.remove("is-soft-target");
      youHero.classList.toggle(
        "is-hit",
        !!(
          ui.anim &&
          ui.anim.type === "strike" &&
          ui.anim.toOwner === "you" &&
          (ui.anim.toIdx === "hero" || ui.anim.toIdx === "face")
        )
      );
    }
  }

  function onBoardClick(owner, idx, ev) {
    if (!g || g.phase === "ended") return;
    if (owner === "enemy") {
      // Directed strike: selected ready unit → chosen enemy
      if (
        g.turnOf !== "you" ||
        ui.selectedBoard == null ||
        ui.busy ||
        (g.phase !== "attack" && g.phase !== "main")
      ) {
        if (g.turnOf === "you" && !ui.busy && ui.selectedBoard == null) {
          setStatus("Direct attack: click one of your green ready units first.", true);
        }
        return;
      }
      var atkIdx = ui.selectedBoard;
      var atkCard = g.you.board[atkIdx];
      if (!atkCard || !isReadyAttacker(atkCard)) {
        setStatus("Select a ready attacker first.", true);
        return;
      }
      g.phase = "attack";
      ui.busy = true;
      playStrikeAnim("you", atkIdx, "enemy", idx).then(function () {
        resolveAttack(g, "you", atkIdx, "enemy", idx);
        ui.selectedBoard = null;
        ui.busy = false;
        if (g.phase !== "ended") g.phase = "main";
        // Keep holds so remaining ready units can still direct or Attack All
        render();
        pushLanIfNeeded();
      });
      return;
    }
    // your board
    if (g.turnOf !== "you") return;
    var card = g.you.board[idx];
    if (!card) return;

    // Weave select mode: toggle 2–5 units
    var fuseMode = $("cd-fusion-mode") && $("cd-fusion-mode").checked;
    if (fuseMode || ui.fusionSelected.length) {
      ui.selectedBoard = null;
      toggleFusionSelect(idx);
      g.phase = "main";
      setStatus(fusionSelectStatus());
      render();
      return;
    }

    // Shift / Alt: hold unit back from Attack All (still free to direct-attack)
    if (ev && (ev.shiftKey || ev.altKey)) {
      toggleAttackHold(idx);
      return;
    }

    beginAttackSelect(idx);
  }

  function render() {
    if (!$("panel-cardduel")) return;
    var game = g;
    // HUD
    if (game) {
      var yhp = $("cd-you-hp");
      var ehp = $("cd-enemy-hp");
      if (yhp) yhp.textContent = String(game.you.hp);
      if (ehp) ehp.textContent = String(game.enemy.hp);
      var yhp2 = $("cd-you-hp-hero");
      var ehp2 = $("cd-enemy-hp-hero");
      if (yhp2) yhp2.textContent = String(game.you.hp);
      if (ehp2) ehp2.textContent = String(game.enemy.hp);
      var ehint = $("cd-enemy-hero-hint");
      if (ehint) {
        var aInfo = getAttackTargetInfo(game);
        if (livingBoard(game.enemy).length) {
          ehint.textContent =
            "Protected by " +
            livingBoard(game.enemy).length +
            " unit(s)" +
            (aInfo.ready > 0
              ? " · " +
                aInfo.unitNames.length +
                " target" +
                (aInfo.unitNames.length === 1 ? "" : "s") +
                " in range"
              : "");
        } else if (aInfo.ready > 0) {
          ehint.textContent =
            ui.selectedBoard != null
              ? "OPEN — click to strike"
              : "OPEN — select a green attacker first";
        } else {
          ehint.textContent = "Field empty (no ready attackers yet)";
        }
      }
      var ybar = $("cd-you-hp-bar");
      var ebar = $("cd-enemy-hp-bar");
      if (ybar) ybar.style.width = Math.max(0, (100 * game.you.hp) / PLAYER_HP) + "%";
      if (ebar) ebar.style.width = Math.max(0, (100 * game.enemy.hp) / PLAYER_HP) + "%";
      var mana = $("cd-mana");
      if (mana) mana.textContent = game.you.mana + " / " + game.you.maxMana;
      var phase = $("cd-phase");
      if (phase) {
        phase.textContent =
          game.phase === "ended"
            ? game.winner === "you"
              ? "Victory"
              : "Defeat"
            : (game.turnOf === "you" ? "Your turn" : game.enemy.name + " turn") +
              " · " +
              game.phase;
      }
      var deckY = $("cd-deck-you");
      var deckE = $("cd-deck-enemy");
      if (deckY) deckY.textContent = "Deck " + game.you.deck.length;
      if (deckE) deckE.textContent = "Enemy deck " + game.enemy.deck.length;
      var logEl = $("cd-log");
      if (logEl) logEl.textContent = (game.logLines || []).join("\n");

      renderBoardRow($("cd-enemy-slots"), game.enemy, "enemy");
      renderBoardRow($("cd-you-slots"), game.you, "you");
      updateHeroTargets();
      updateAttackIndicator();

      var attackAllBtn = $("cd-attack-all");
      if (attackAllBtn) {
        var readyN = readyAttackerCount(game.you);
        var swingN = readyAttackerCount(game.you, { skipHeld: true });
        var heldN = heldAttackerCount();
        var canAtk =
          game.turnOf === "you" &&
          game.phase !== "ended" &&
          !ui.busy &&
          swingN > 0;
        attackAllBtn.disabled = !canAtk;
        attackAllBtn.classList.toggle("is-lit", canAtk);
        if (swingN > 0) {
          attackAllBtn.textContent =
            "Attack with all ready (" +
            swingN +
            (heldN > 0 ? ", " + heldN + " held" : "") +
            ")";
        } else if (readyN > 0 && heldN > 0) {
          attackAllBtn.textContent = "Attack All (all " + heldN + " held)";
        } else {
          attackAllBtn.textContent = "Attack with all ready";
        }
        attackAllBtn.title =
          "Mass swing for every ready unit that is not HELD. " +
          "Direct-attack: click a green unit, then a red target. " +
          "Shift+click a unit to hold it back from this button.";
      }
      var cancelAtkBtn = $("cd-cancel-attack");
      if (cancelAtkBtn) {
        var canCancel =
          game.turnOf === "you" &&
          !ui.busy &&
          ui.selectedBoard != null &&
          game.phase !== "ended";
        cancelAtkBtn.disabled = !canCancel;
        cancelAtkBtn.hidden = !canCancel;
      }

      var hand = $("cd-hand");
      if (hand) {
        hand.innerHTML = "";
        var sorted = sortHandCards(game.you.hand);
        sorted.forEach(function (card) {
          var realIdx = game.you.hand.indexOf(card);
          var afford =
            game.turnOf === "you" &&
            game.phase === "main" &&
            card.cost <= game.you.mana;
          var e = EFFECTS[card.effect];
          hand.appendChild(
            cardButton(card, {
              selected: ui.selectedHand === realIdx,
              disabled: game.turnOf !== "you" || game.phase === "ended",
              onClick: function () {
                if (game.turnOf !== "you" || game.phase === "ended") return;
                if (game.phase !== "main") {
                  g.phase = "main";
                  ui.selectedBoard = null;
                }
                if (ui.selectedHand === realIdx) {
                  playCardFromHand(g, realIdx);
                } else {
                  ui.selectedHand = realIdx;
                  setStatus(
                    (afford
                      ? "Click again to play " +
                        card.name +
                        " (" +
                        card.cost +
                        " mana)."
                      : "Need " + card.cost + " mana (have " + game.you.mana + ").") +
                      (e ? " Effect: " + e.name + " — " + e.desc : "")
                  );
                  render();
                }
              },
            })
          );
        });
      }
      // Sort button active states
      ["mana", "atk", "hp", "name"].forEach(function (key) {
        var btn = $("cd-sort-" + key);
        if (btn) btn.classList.toggle("is-active", ui.handSort === key);
      });
    }

    var attackBtn = $("cd-attack-all");
    var endBtn = $("cd-end-turn");
    var fuseBtn = $("cd-forge-fusion");
    var yourTurn = game && game.turnOf === "you" && game.phase !== "ended";
    // Keep attack-all disabled when no ready units (do not overwrite readyN logic above)
    if (attackBtn && !game) attackBtn.disabled = true;
    if (endBtn) endBtn.disabled = !yourTurn;
    var creditsOk = canUseWeaveCredits();
    if (fuseBtn) {
      if (!creditsOk) {
        fuseBtn.disabled = true;
        fuseBtn.textContent = "Weave disabled (no credits)";
        fuseBtn.title =
          "Add xAI credits at console.x.ai — weave unlocks after credits return.";
      } else {
        fuseBtn.disabled = !(
          yourTurn &&
          !ui.busy &&
          ui.fusionSelected.length >= FUSE_MIN &&
          ui.fusionSelected.length <= FUSE_MAX
        );
        fuseBtn.textContent =
          ui.fusionSelected.length >= FUSE_MIN
            ? "Weave " + ui.fusionSelected.length + " cards (ends turn)"
            : "Weave cards (ends turn)";
        fuseBtn.title = "Spends API credits to generate brand-new card art";
      }
    }
    updateWeaveCreditsUi();
    if (lan.mode === "lan") renderPlayerRoster();
  }

  /* —— LAN —— */
  function sanitizePlayerName(raw) {
    var n = String(raw || "")
      .replace(/[<>\"'\\]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);
    return n;
  }

  function getDisplayName(requireName) {
    var el = $("cd-player-name");
    var n = el ? sanitizePlayerName(el.value) : "";
    if (!n) {
      try {
        n = sanitizePlayerName(localStorage.getItem("cd-player-name") || "");
      } catch (e) {}
    }
    if (!n && requireName) {
      setStatus("Enter your name so the host knows who joined.", true);
      if (el) {
        try {
          el.focus();
        } catch (e2) {}
      }
      return "";
    }
    if (!n) n = lan.isHost ? "Host" : "";
    if (n) {
      lan.displayName = n;
      if (el && !el.value) el.value = n;
      try {
        localStorage.setItem("cd-player-name", n);
      } catch (e3) {}
    }
    return n;
  }

  function renderPlayerRoster() {
    var el = $("cd-player-roster");
    if (!el) return;
    var players = lan.players || [];
    if (lan.mode !== "lan" || !lan.room) {
      el.innerHTML =
        '<p class="cd-roster-empty">No challenge room yet. Host or join to see who is here.</p>';
      return;
    }
    if (!players.length) {
      el.innerHTML =
        '<p class="cd-roster-empty">Room ' +
        escapeHtml(lan.room) +
        " — waiting for players…</p>";
      return;
    }
    var html =
      '<div class="cd-roster-head">Room ' +
      escapeHtml(lan.room) +
      " · " +
      players.length +
      " online</div><ul class=\"cd-roster-list\">";
    players.forEach(function (p) {
      var name = sanitizePlayerName(p.name) || (p.host ? "Host" : "Guest");
      var you = p.playerId === lan.playerId;
      var role = p.host ? "Host" : "Challenger";
      html +=
        '<li class="cd-roster-item' +
        (p.host ? " is-host" : " is-guest") +
        (you ? " is-you" : "") +
        '">' +
        '<span class="cd-roster-name">' +
        escapeHtml(name) +
        (you ? " (you)" : "") +
        "</span>" +
        '<span class="cd-roster-role">' +
        escapeHtml(role) +
        "</span></li>";
    });
    html += "</ul>";
    el.innerHTML = html;
  }

  function applyRoomPlayers(players) {
    lan.players = Array.isArray(players) ? players : [];
    renderPlayerRoster();
    if (!lan.isHost || !g) return;

    // Announce new guests by name; set enemy hero label to their name
    var guests = lan.players.filter(function (p) {
      return p && !p.host && p.playerId !== lan.playerId;
    });
    var changed = false;
    guests.forEach(function (guest) {
      var gName = sanitizePlayerName(guest.name);
      if (!gName || gName === "Guest") return;
      if (!lan.announced[guest.playerId]) {
        lan.announced[guest.playerId] = true;
        log(g, gName + " joined the challenge.");
        setStatus(gName + " joined the room.");
        changed = true;
      }
      if (g.enemy && g.enemy.name !== gName) {
        g.enemy.name = gName;
        g.enemy.isCpu = false;
        changed = true;
      }
    });
    if (changed) {
      render();
      pushLanIfNeeded();
    }
  }

  function lanPayload(action, withState) {
    return {
      action: action || (lan.isHost ? "sync" : "join"),
      room: lan.room,
      playerId: lan.playerId,
      isHost: !!lan.isHost,
      name: lan.displayName || getDisplayName(false) || "",
      state: withState && lan.isHost && g ? snapshotState() : undefined,
    };
  }

  function pushLanIfNeeded() {
    if (lan.mode !== "lan" || !lan.room || !g) return;
    if (!lan.isHost) {
      // Guest presence heartbeat with name only
      fetch(apiUrl("/api/cardduel/room"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lanPayload("join", false)),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (d && d.players) applyRoomPlayers(d.players);
        })
        .catch(function () {});
      return;
    }
    fetch(apiUrl("/api/cardduel/room"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lanPayload("sync", true)),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d && d.players) applyRoomPlayers(d.players);
      })
      .catch(function () {});
  }

  function snapshotState() {
    if (!g) return null;
    return JSON.parse(JSON.stringify(g));
  }

  function applyRemoteState(state) {
    if (!state) return;
    g = state;
    // Guest sees mirrored sides: host is "you" on host machine; guest maps enemy as self?
    // Simple model: both share same state; host is always "you" in state.
    // Guest interacts as enemy side via LAN actions.
    render();
  }

  function startLanPoll() {
    stopLanPoll();
    function tick() {
      if (lan.mode !== "lan" || !lan.room) return;
      // Heartbeat keeps names + presence alive; host also publishes board state
      var body = lanPayload(lan.isHost ? "sync" : "join", !!lan.isHost);
      fetch(apiUrl("/api/cardduel/room"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (!d || d.ok === false) return;
          if (d.players) applyRoomPlayers(d.players);
          if (!lan.isHost && d.state) {
            var remote = d.state;
            if (
              !g ||
              remote.turnOf !== g.turnOf ||
              remote.phase !== g.phase ||
              (remote.logLines &&
                g.logLines &&
                remote.logLines.length !== g.logLines.length) ||
              (remote.enemy &&
                g.enemy &&
                remote.enemy.name !== g.enemy.name)
            ) {
              g = remote;
              render();
            }
          }
        })
        .catch(function () {});
    }
    tick();
    lan.poll = setInterval(tick, 1200);
  }

  function stopLanPoll() {
    if (lan.poll) {
      clearInterval(lan.poll);
      lan.poll = 0;
    }
  }

  function inviteLinkForBase(base, room) {
    var b = String(base || "").replace(/\/$/, "");
    if (!b) b = location.origin;
    try {
      var u = new URL(b.indexOf("http") === 0 ? b : "http://" + b);
      u.searchParams.set("cdroom", String(room));
      u.hash = "cardduel";
      // Keep path if base was only origin
      if (!u.pathname || u.pathname === "/") {
        var path = location.pathname || "/";
        if (path && path !== "/") u.pathname = path;
      }
      return u.toString();
    } catch (e) {
      return (
        b +
        (b.indexOf("?") >= 0 ? "&" : "?") +
        "cdroom=" +
        encodeURIComponent(room) +
        "#cardduel"
      );
    }
  }

  /**
   * Classify invite URLs:
   * - remote = long-distance (Tailscale / public host) — SEND THIS off-Wi‑Fi
   * - wifi   = private LAN IP — same network only
   * - local  = localhost — this PC only
   */
  function classifyInviteUrl(url) {
    try {
      var u = new URL(url);
      var host = (u.hostname || "").toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host === "0.0.0.0"
      ) {
        return "local";
      }
      // Tailscale MagicDNS / Funnel-style hosts — preferred long-distance
      if (
        host.indexOf(".ts.net") >= 0 ||
        host.indexOf("tailscale") >= 0 ||
        /\.ts\.net$/i.test(host)
      ) {
        return "remote";
      }
      // Private / home LAN ranges
      if (
        /^10\.\d+\.\d+\.\d+$/.test(host) ||
        /^192\.168\.\d+\.\d+$/.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host) ||
        /^169\.254\.\d+\.\d+$/.test(host) ||
        host.endsWith(".local")
      ) {
        return "wifi";
      }
      // Any other real hostname / public IP
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        // Public-looking IPv4 (not in private ranges above)
        return "remote";
      }
      if (host.indexOf(".") >= 0) return "remote";
      return "wifi";
    } catch (e) {
      return "wifi";
    }
  }

  function inviteKindLabel(kind) {
    if (kind === "remote") return "★ LONG DISTANCE — send this";
    if (kind === "wifi") return "Same Wi‑Fi only";
    if (kind === "local") return "This PC only";
    return "Link";
  }

  function buildInviteLinks(room) {
    var pageBase = location.origin + (location.pathname || "/");
    var fromPage = inviteLinkForBase(pageBase, room);

    function collect(phone, transfer) {
      var items = [];
      var seen = {};
      function add(base, source) {
        if (!base) return;
        var url = inviteLinkForBase(base, room);
        if (!url || seen[url]) return;
        seen[url] = true;
        var kind = classifyInviteUrl(url);
        items.push({
          url: url,
          kind: kind,
          source: source || "",
        });
      }

      // 1) Tailscale / phone HTTPS first (this is the long-distance path)
      if (phone && phone.ok) {
        if (phone.https_origin) add(phone.https_origin, "tailscale");
        if (phone.https_gallery) add(phone.https_gallery, "tailscale");
        if (phone.magic_dns) {
          add("https://" + String(phone.magic_dns).replace(/\/$/, ""), "tailscale");
          // HTTP:8765 fallback if serve isn't on 443
          add(
            "http://" + String(phone.magic_dns).replace(/\/$/, "") + ":8765",
            "tailscale-http"
          );
        }
      }

      // 2) Whatever address the host is currently using in the browser
      add(pageBase, "browser");

      // 3) Same-Wi‑Fi LAN IPs
      if (transfer) {
        if (transfer.bestLanUrl) add(transfer.bestLanUrl, "lan");
        if (Array.isArray(transfer.lanUrls)) {
          transfer.lanUrls.forEach(function (u) {
            add(u, "lan");
          });
        }
      }

      // Prefer remote → wifi → local; within remote prefer https + ts.net
      var rank = { remote: 0, wifi: 1, local: 2 };
      items.sort(function (a, b) {
        var kr = (rank[a.kind] != null ? rank[a.kind] : 9) - (rank[b.kind] != null ? rank[b.kind] : 9);
        if (kr !== 0) return kr;
        var aTs = a.url.indexOf(".ts.net") >= 0 ? 0 : 1;
        var bTs = b.url.indexOf(".ts.net") >= 0 ? 0 : 1;
        if (aTs !== bTs) return aTs - bTs;
        var aHttps = a.url.indexOf("https://") === 0 ? 0 : 1;
        var bHttps = b.url.indexOf("https://") === 0 ? 0 : 1;
        if (aHttps !== bHttps) return aHttps - bHttps;
        return a.url.localeCompare(b.url);
      });

      var remote = items.filter(function (it) {
        return it.kind === "remote";
      });
      var wifi = items.filter(function (it) {
        return it.kind === "wifi";
      });
      var localOnly = items.filter(function (it) {
        return it.kind === "local";
      });

      // Preferred for "Copy" = starred long-distance link when available
      var preferred =
        (remote[0] && remote[0].url) ||
        (wifi[0] && wifi[0].url) ||
        fromPage;

      return {
        preferred: preferred,
        primary: preferred,
        remote: remote,
        wifi: wifi,
        local: localOnly,
        all: items,
        hasRemote: remote.length > 0,
      };
    }

    var phoneP = fetch(apiUrl("/api/phone-access?t=" + Date.now()), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return null;
      });
    var transferP = fetch(apiUrl("/api/transfer/status?t=" + Date.now()), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return null;
      });

    return Promise.all([phoneP, transferP]).then(function (pair) {
      return collect(pair[0], pair[1]);
    });
  }

  function showInviteUi(room, links) {
    var roomIn = $("cd-lan-room");
    if (roomIn) roomIn.value = room;
    var linkIn = $("cd-invite-link");
    var listEl = $("cd-invite-list");
    var panel = $("cd-invite-panel");
    var starLabel = $("cd-invite-star-label");
    var warnEl = $("cd-invite-remote-warn");
    if (panel) panel.hidden = false;

    var preferred = (links && (links.preferred || links.primary)) || "";
    var hasRemote = !!(links && links.hasRemote);

    if (starLabel) {
      starLabel.textContent = hasRemote
        ? "★ SEND THIS for long distance (not same Wi‑Fi)"
        : "No long-distance link found — see note below";
      starLabel.classList.toggle("is-remote", hasRemote);
      starLabel.classList.toggle("is-missing", !hasRemote);
    }
    if (warnEl) {
      if (hasRemote) {
        warnEl.hidden = false;
        warnEl.className = "cd-invite-remote-warn is-ok";
        warnEl.textContent =
          "Friend needs Tailscale connected (same tailnet) or access to this public host. Copy the ★ starred link only for long distance.";
      } else {
        warnEl.hidden = false;
        warnEl.className = "cd-invite-remote-warn is-bad";
        warnEl.textContent =
          "No long-distance link yet. Wi‑Fi links (192.168…) will not work far away. Connect Tailscale on this PC (and start_server.bat), or open the gallery via a public URL, then Host again.";
      }
    }

    if (linkIn) {
      linkIn.value = preferred;
      linkIn.classList.toggle("is-remote-preferred", hasRemote);
      try {
        linkIn.focus();
        linkIn.select();
      } catch (e) {}
    }

    if (listEl) {
      listEl.innerHTML = "";
      function addSection(title, items, sectionClass) {
        if (!items || !items.length) return;
        var h = document.createElement("div");
        h.className = "cd-invite-section-title " + (sectionClass || "");
        h.textContent = title;
        listEl.appendChild(h);
        items.forEach(function (it, i) {
          var row = document.createElement("button");
          row.type = "button";
          row.className =
            "cd-invite-alt kind-" +
            it.kind +
            (it.url === preferred && it.kind === "remote" ? " is-starred" : "") +
            (it.url === preferred ? " is-primary" : "");
          var star = it.kind === "remote" && (i === 0 || it.url === preferred) ? "★ " : "";
          row.innerHTML =
            '<span class="cd-invite-kind">' +
            escapeHtml(star + inviteKindLabel(it.kind)) +
            "</span>" +
            '<span class="cd-invite-url">' +
            escapeHtml(it.url) +
            "</span>";
          row.title =
            it.kind === "remote"
              ? "Copy — this is the long-distance invite"
              : it.kind === "wifi"
                ? "Copy — same Wi‑Fi only"
                : "Copy — this PC only";
          row.addEventListener("click", function () {
            if (linkIn) {
              linkIn.value = it.url;
              linkIn.classList.toggle("is-remote-preferred", it.kind === "remote");
            }
            if (starLabel && it.kind === "remote") {
              starLabel.textContent = "★ SEND THIS for long distance (not same Wi‑Fi)";
              starLabel.classList.add("is-remote");
              starLabel.classList.remove("is-missing");
            }
            copyInviteLink(it.url, it.kind);
          });
          listEl.appendChild(row);
        });
      }

      addSection(
        "★ Long distance (send this when not on the same Wi‑Fi)",
        links.remote || [],
        "is-remote-sec"
      );
      addSection("Same Wi‑Fi only", links.wifi || [], "is-wifi-sec");
      addSection("This PC only (do not send)", links.local || [], "is-local-sec");
    }
  }

  function copyInviteLink(text, kind) {
    var val =
      text ||
      ($("cd-invite-link") && $("cd-invite-link").value) ||
      "";
    if (!val) {
      setStatus("No invite link yet — host a challenge first.", true);
      return;
    }
    var k = kind || classifyInviteUrl(val);
    function ok() {
      if (k === "remote") {
        setStatus(
          "★ Long-distance invite copied. Send THIS link (not 192.168…). Room " +
            lan.room +
            "."
        );
      } else if (k === "wifi") {
        setStatus(
          "Same-Wi‑Fi link copied (192.168 / 10.x). Will NOT work at long distance. Room " +
            lan.room +
            "."
        );
      } else {
        setStatus(
          "Localhost link copied — only works on this PC. Prefer the ★ long-distance link."
        );
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(ok).catch(function () {
        fallbackCopy(val);
        ok();
      });
    } else {
      fallbackCopy(val);
      ok();
    }
  }

  function fallbackCopy(val) {
    var ta = document.createElement("textarea");
    ta.value = val;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
  }

  function readInviteRoomFromUrl() {
    try {
      var q = new URLSearchParams(location.search || "");
      var room = String(q.get("cdroom") || q.get("room") || "").trim();
      if (room) return room.slice(0, 12);
      // Also allow #cardduel?cdroom= or hash query style
      var hash = String(location.hash || "").replace(/^#/, "");
      if (hash.indexOf("cdroom=") >= 0) {
        var hq = new URLSearchParams(hash.split("?").slice(1).join("?") || hash);
        room = String(hq.get("cdroom") || "").trim();
        if (room) return room.slice(0, 12);
      }
    } catch (e) {}
    return "";
  }

  function hostLan() {
    var hostName = getDisplayName(true);
    if (!hostName) {
      setStatus("Enter your name first (so challengers know who is hosting).", true);
      return;
    }
    lan.playerId = lan.playerId || uid();
    lan.room = String(Math.floor(1000 + Math.random() * 9000));
    lan.isHost = true;
    lan.mode = "lan";
    lan.announced = {};
    lan.players = [];
    var roomIn = $("cd-lan-room");
    if (roomIn) roomIn.value = lan.room;
    loadPool().then(function () {
      newGame("lan", "Waiting…");
      g.you.name = hostName;
      g.enemy.isCpu = false;
      g.enemy.name = "Waiting…";
      log(g, hostName + " hosts room " + lan.room + ".");
      fetch(apiUrl("/api/cardduel/room"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "host",
          room: lan.room,
          playerId: lan.playerId,
          isHost: true,
          name: hostName,
          state: snapshotState(),
        }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (d && d.ok === false) throw new Error(d.error || "Host failed");
          if (d && d.players) applyRoomPlayers(d.players);
          startLanPoll();
          return buildInviteLinks(lan.room);
        })
        .then(function (links) {
          showInviteUi(lan.room, links);
          if (links && links.hasRemote) {
            setStatus(
              "Hosting as " +
                hostName +
                " · room " +
                lan.room +
                ". ★ Send the starred link — friends must enter their name to join."
            );
          } else {
            setStatus(
              "Hosting as " +
                hostName +
                " · room " +
                lan.room +
                ". Only same-Wi‑Fi links available for now.",
              true
            );
          }
          pushLanIfNeeded();
          renderPlayerRoster();
        })
        .catch(function (err) {
          setStatus((err && err.message) || "Host failed — is the gallery server running?", true);
        });
    });
  }

  function joinLan(codeOpt) {
    var roomIn = $("cd-lan-room");
    var code =
      codeOpt != null
        ? String(codeOpt).trim()
        : roomIn
          ? String(roomIn.value || "").trim()
          : "";
    if (!code) {
      setStatus("Enter a room code or open an invite link.", true);
      return Promise.resolve(false);
    }
    var name = getDisplayName(true);
    if (!name) {
      setStatus("Enter your name, then Join — the host will see who entered.", true);
      return Promise.resolve(false);
    }
    lan.playerId = lan.playerId || uid();
    lan.room = code;
    lan.isHost = false;
    lan.mode = "lan";
    lan.displayName = name;
    lan.announced = {};
    if (roomIn) roomIn.value = code;
    return fetch(apiUrl("/api/cardduel/room"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "join",
        room: lan.room,
        playerId: lan.playerId,
        isHost: false,
        name: name,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d && d.ok === false) throw new Error(d.error || "Join failed");
        if (d && d.players) applyRoomPlayers(d.players);
        if (d && d.state) {
          g = d.state;
          if (g.enemy) g.enemy.isCpu = false;
          render();
        }
        setStatus(
          "Joined as “" +
            name +
            "” · room " +
            lan.room +
            ". The host can see your name in the roster."
        );
        startLanPoll();
        var panel = $("cd-invite-panel");
        if (panel) panel.hidden = true;
        var joinGate = $("cd-join-gate");
        if (joinGate) joinGate.hidden = true;
        renderPlayerRoster();
        return true;
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Join failed — is the host online?", true);
        return false;
      });
  }

  function tryAutoJoinFromInvite() {
    var room = ui.inviteJoinPending || readInviteRoomFromUrl();
    if (!room) return;
    ui.inviteJoinPending = room;
    var roomIn = $("cd-lan-room");
    if (roomIn) roomIn.value = room;
    var joinGate = $("cd-join-gate");
    if (joinGate) joinGate.hidden = false;
    // Require name before auto-joining so host sees who entered
    var saved = "";
    try {
      saved = sanitizePlayerName(localStorage.getItem("cd-player-name") || "");
    } catch (e) {}
    var nameEl = $("cd-player-name");
    if (nameEl && saved && !nameEl.value) nameEl.value = saved;
    if (saved) {
      setStatus(
        "Invite for room " +
          room +
          " — joining as “" +
          saved +
          "” (change name above if needed)…"
      );
      loadPool().then(function () {
        joinLan(room).then(function (ok) {
          if (ok) ui.inviteJoinPending = null;
        });
      });
    } else {
      setStatus(
        "Invite for room " +
          room +
          " — type your name, then press Join so the host knows who you are."
      );
      if (nameEl) {
        try {
          nameEl.focus();
        } catch (e2) {}
      }
    }
  }

  /* —— Bind —— */
  function bind() {
    var panel = $("panel-cardduel");
    if (!panel || panel._cdBound) return;
    panel._cdBound = true;

    var vsCpu = $("cd-vs-cpu");
    if (vsCpu) {
      vsCpu.addEventListener("click", function () {
        stopLanPoll();
        lan.mode = "cpu";
        setStatus("Loading spell / generated cards…");
        loadPool().then(function () {
          newGame("cpu", "CPU");
        });
      });
    }
    var host = $("cd-lan-host");
    if (host) host.addEventListener("click", hostLan);
    var join = $("cd-lan-join");
    if (join) {
      join.addEventListener("click", function () {
        var room = ui.inviteJoinPending || readInviteRoomFromUrl() || undefined;
        joinLan(room);
      });
    }
    var nameEl = $("cd-player-name");
    if (nameEl) {
      try {
        var saved = localStorage.getItem("cd-player-name");
        if (saved && !nameEl.value) nameEl.value = sanitizePlayerName(saved);
      } catch (eN) {}
      nameEl.addEventListener("change", function () {
        var n = sanitizePlayerName(nameEl.value);
        nameEl.value = n;
        if (n) {
          lan.displayName = n;
          try {
            localStorage.setItem("cd-player-name", n);
          } catch (eS) {}
        }
      });
      nameEl.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          var room =
            ( $("cd-lan-room") && $("cd-lan-room").value) ||
            ui.inviteJoinPending ||
            "";
          if (String(room).trim()) joinLan(String(room).trim());
        }
      });
    }
    renderPlayerRoster();
    var copyBtn = $("cd-invite-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        copyInviteLink();
      });
    }
    var cancelAtk = $("cd-cancel-attack");
    if (cancelAtk) {
      cancelAtk.addEventListener("click", function () {
        if (!g || ui.busy) return;
        cancelAttackSelect();
      });
    }

    ["mana", "atk", "hp", "name"].forEach(function (key) {
      var btn = $("cd-sort-" + key);
      if (!btn || btn._cdSort) return;
      btn._cdSort = true;
      btn.addEventListener("click", function () {
        ui.handSort = key;
        ui.selectedHand = null;
        render();
      });
    });
    renderEffectLegend();

    var attackAll = $("cd-attack-all");
    if (attackAll) {
      attackAll.addEventListener("click", function () {
        if (!g || g.turnOf !== "you" || g.phase === "ended" || ui.busy) return;
        var swingN = readyAttackerCount(g.you, { skipHeld: true });
        if (!swingN) {
          setStatus(
            heldAttackerCount()
              ? "Every ready unit is held — direct-attack or Shift+click to unhold."
              : "No ready attackers (need Rush, or wait a turn).",
            true
          );
          return;
        }
        g.phase = "attack";
        setStatus(
          "Attack All: resolving " +
            swingN +
            " ready unit" +
            (swingN === 1 ? "" : "s") +
            (heldAttackerCount()
              ? " (" + heldAttackerCount() + " held back)…"
              : "…")
        );
        attackAllReady(g, "you").then(function (any) {
          if (!any) {
            setStatus(
              heldAttackerCount()
                ? "Nothing swung — units are held or not ready."
                : "No ready attackers (need Rush, or wait a turn).",
              true
            );
          } else {
            var left = readyAttackerCount(g.you);
            setStatus(
              left
                ? "Attack All finished — " +
                    left +
                    " still ready (held or unspent). Direct-attack or End turn."
                : "Attack All finished."
            );
          }
          if (g.phase !== "ended") g.phase = "main";
          ui.selectedBoard = null;
          render();
          pushLanIfNeeded();
        });
      });
    }

    var forge = $("cd-forge-fusion");
    if (forge) {
      forge.addEventListener("click", function () {
        if (!g || g.turnOf !== "you" || g.phase === "ended" || ui.busy) return;
        if (!canUseWeaveCredits()) {
          setStatus(
            "No API credits — weave is disabled (will not retry).",
            true
          );
          updateWeaveCreditsUi();
          return;
        }
        if (
          ui.fusionSelected.length < FUSE_MIN ||
          ui.fusionSelected.length > FUSE_MAX
        ) {
          setStatus(
            "Enable Weave mode and select " +
              FUSE_MIN +
              "–" +
              FUSE_MAX +
              " of your units.",
            true
          );
          return;
        }
        var promptEl = $("cd-fusion-prompt");
        var text = promptEl ? promptEl.value : "";
        forge.disabled = true;
        fuseUnits(g, "you", ui.fusionSelected.slice(), text, false).finally(
          function () {
            render();
          }
        );
      });
    }

    // Re-enable weave when credits HUD recovers (no polling loop on fuse itself)
    window.addEventListener("xai-usage-updated", function () {
      if (ui.creditsBlocked && canUseWeaveCredits()) {
        ui.creditsBlocked = false;
      }
      updateWeaveCreditsUi();
      if (g) render();
    });

    function strikeHero() {
      if (!g || g.turnOf !== "you" || ui.selectedBoard == null || ui.busy) return;
      if (livingBoard(g.enemy).length) {
        setStatus("Clear the enemy field before striking the hero.", true);
        return;
      }
      var atkIdx = ui.selectedBoard;
      ui.busy = true;
      playStrikeAnim("you", atkIdx, "enemy", "hero").then(function () {
        resolveAttack(g, "you", atkIdx, "enemy", "hero");
        ui.selectedBoard = null;
        ui.busy = false;
        if (g.phase !== "ended") g.phase = "main";
        render();
        pushLanIfNeeded();
      });
    }

    var faceBtn = $("cd-attack-face");
    if (faceBtn) faceBtn.addEventListener("click", strikeHero);
    var enemyHero = $("cd-enemy-hero");
    if (enemyHero) enemyHero.addEventListener("click", strikeHero);
  }

  // Fix end turn: I accidentally shadowed - redefine handler carefully
  function bindEndTurnFix() {
    var endBtn = $("cd-end-turn");
    if (!endBtn || endBtn._cdFixed) return;
    endBtn._cdFixed = true;
    endBtn.addEventListener("click", function () {
      if (!g || g.turnOf !== "you" || g.phase === "ended") return;
      endTurn(g);
    });
  }

  function onShow() {
    bind();
    bindEndTurnFix();
    loadPool().then(function () {
      if (!g) {
        setStatus(
          "Cards loaded. Vs CPU, or Host challenge and send the invite link (same Wi‑Fi)."
        );
      }
      render();
      tryAutoJoinFromInvite();
    });
  }

  // Deep link: ?cdroom=#####cardduel — queue join even before tab show
  (function queueInviteFromUrl() {
    var room = readInviteRoomFromUrl();
    if (room) ui.inviteJoinPending = room;
  })();

  function onHide() {
    stopLanPoll();
  }

  window.CardDuel = { onShow: onShow, onHide: onHide };
  window.addEventListener("cardduel-show", onShow);
  window.addEventListener("cardduel-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
