/**
 * Muralwalk painting / spell-slot math only — no world coordinates.
 */
(function () {
  if (window.MuralwalkSpellMath) return;
  var SLOT_LABELS = ["Spell I", "Spell II", "Spell III"];
  var TOTAL_PAINTINGS = 1000;

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

  function buildSpellPool(total, exclude, hasAnalysis) {
    var excludeMap = {};
    (exclude || []).forEach(function (n) {
      excludeMap[n] = true;
    });
    var pool = [];
    var max = total || TOTAL_PAINTINGS;
    for (var i = 1; i <= max; i++) {
      if (excludeMap[i]) continue;
      if (!hasAnalysis || hasAnalysis(i)) pool.push(i);
    }
    if (!pool.length) {
      for (var j = 1; j <= max; j++) {
        if (!excludeMap[j]) pool.push(j);
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