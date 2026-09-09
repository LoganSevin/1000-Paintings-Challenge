/**
 * Muralwalk painting / spell-slot math only — no world coordinates.
 */
(function () {
  if (window.MuralwalkSpellMath) return;
  var SLOT_LABELS = ["Spell I", "Spell II", "Spell III"];
  var TOTAL_PAINTINGS = 1000;
  var GEN_BASE = 100000;
  var SKETCH_BASE = 200000;
  var INV_SKETCH_BASE = 300000;

  function spellHash(seed, n) {
    var h = seed * 374761393 + n * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function equippedNums(slots) {
    return (slots || []).filter(function (n) {
      return n >= 1;
    });
  }

  function paintingUrlFor(num) {
    num = parseInt(num, 10);
    if (!num) return "";
    try {
      if (typeof window.getSpellforgeSpellUrl === "function") {
        var raw = String(window.getSpellforgeSpellUrl(num) || "");
        var bogus = /(?:^|\/)paintings\/(\d+)\./i.exec(raw);
        if (raw && !(num > 1000 && bogus && parseInt(bogus[1], 10) === num)) return raw;
      }
    } catch (e) {}
    if (num >= 1 && num <= 1000) {
      if (window.getPaintingUrl) return window.getPaintingUrl(num);
      return "paintings/" + num + ".jpg";
    }
    if (num >= GEN_BASE && num < SKETCH_BASE) return "generated/" + (num - GEN_BASE) + ".jpg";
    if (num >= SKETCH_BASE && num < INV_SKETCH_BASE) return "sketches/" + (num - SKETCH_BASE) + ".png";
    if (num >= INV_SKETCH_BASE && num < 400000) {
      return "sketches-inverted/" + (num - INV_SKETCH_BASE) + ".png";
    }
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function spellsMatch(a, b) {
    if (!a || !b || a.length < 2 || b.length < 2) return false;
    return a.join(",") === b.join(",");
  }

  function floorRequestKey(nums, variant, stasisText, unlockFloor) {
    return (
      nums.join(",") +
      "|" +
      variant +
      "|" +
      (stasisText || "").slice(0, 64) +
      "|" +
      (unlockFloor ? "u" : "p")
    );
  }

  function pickFromPool(pool, seed) {
    if (!pool || !pool.length) return null;
    return pool[spellHash(seed, pool.length) % pool.length];
  }

  function buildSpellPool(totalOrList, exclude, hasAnalysis) {
    var excludeMap = {};
    (exclude || []).forEach(function (n) {
      excludeMap[n] = true;
    });
    var ids = [];
    if (Array.isArray(totalOrList)) {
      ids = totalOrList;
    } else {
      var max = totalOrList || TOTAL_PAINTINGS;
      for (var i = 1; i <= max; i++) ids.push(i);
    }
    var pool = [];
    for (var k = 0; k < ids.length; k++) {
      var n = ids[k];
      if (!n || excludeMap[n]) continue;
      if (!hasAnalysis || hasAnalysis(n)) pool.push(n);
    }
    if (!pool.length) {
      for (var j = 0; j < ids.length; j++) {
        if (ids[j] && !excludeMap[ids[j]]) pool.push(ids[j]);
      }
    }
    return pool;
  }

  function orbValueIndex(orbIndex, worldSeed, score, valueCount) {
    return spellHash(worldSeed + score, orbIndex) % valueCount;
  }

  function slotLabel(index) {
    return SLOT_LABELS[index] || "Spell";
  }

  function entityKindFromText(text) {
    var lower = String(text || "").toLowerCase();
    if (
      /\b(bat|eye|eyes|spirit|shadow|beast|creature|phantom|specter|demon|wraith|spectre|monster|fiend|hunter)\b/.test(
        lower
      )
    ) {
      return "enemy";
    }
    if (
      /\b(tree|dune|dunes|rock|rocks|wall|pillar|arch|gate|tower|obelisk|branch|desert|column|cliff|stone|forest)\b/.test(
        lower
      )
    ) {
      return "obstacle";
    }
    return "prop";
  }

  function spellEntityHint(num, getAnalysis) {
    var a = getAnalysis ? getAnalysis(num) : null;
    if (!a) return null;
    var blob =
      (a.title || "") +
      " " +
      (a.tags || []).join(" ") +
      " " +
      (a.description || "").slice(0, 120);
    var kind = entityKindFromText(blob);
    if (kind === "prop") return null;
    return {
      kind: kind,
      subject: a.title || "Painting #" + num,
      spellNum: num,
    };
  }

  window.MuralwalkSpellMath = {
    SLOT_LABELS: SLOT_LABELS,
    TOTAL_PAINTINGS: TOTAL_PAINTINGS,
    GEN_BASE: GEN_BASE,
    SKETCH_BASE: SKETCH_BASE,
    INV_SKETCH_BASE: INV_SKETCH_BASE,
    spellHash: spellHash,
    equippedNums: equippedNums,
    paintingUrlFor: paintingUrlFor,
    spellsMatch: spellsMatch,
    floorRequestKey: floorRequestKey,
    pickFromPool: pickFromPool,
    buildSpellPool: buildSpellPool,
    orbValueIndex: orbValueIndex,
    slotLabel: slotLabel,
    entityKindFromText: entityKindFromText,
    spellEntityHint: spellEntityHint,
  };
})();