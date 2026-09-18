/**
 * MOBA — League-style 5v5-lite: click-to-move, lanes, towers, minions, QWER.
 */
(function () {
  "use strict";

  var W = 9600;
  var H = 9600;
  var canvas;
  var ctx;
  var viewW = 900;
  var viewH = 600;
  var running = false;
  var raf = 0;
  var lastT = 0;
  var cam = { x: 200, y: 1200 };
  var keys = {};
  var mouse = { x: 0, y: 0, worldX: 0, worldY: 0, down: false, right: false };
  var gold = 500;
  var kda = [0, 0, 0];
  var spawnT = 0;
  var waveN = 0;
  var ended = "";
  var shopOpen = false;
  var units = [];
  var shots = [];
  var player = null;
  var catalogItems = [];
  var itemsById = {};
  var selectedId = "";
  var shopCat = "all";
  var shopQuery = "";
  var regenBusy = false;
  var groveTime = 0;
  var groveImgs = [null, null, null, null];
  var gateImgs = [null, null];
  var champImgs = [null, null, null];
  var groveLoaded = false;
  var SHOP_CATS = [
    { id: "all", label: "All items", group: "" },
    { id: "items", label: "Items", group: "" },
    { id: "components", label: "Components", group: "" },
    { id: "start", label: "Start", group: "" },
    { id: "tools", label: "Tools", group: "" },
    { id: "transforms", label: "Transforms", group: "" },
    { id: "ad", label: "Attack Damage", group: "Attack" },
    { id: "as", label: "Attack Speed", group: "Attack" },
    { id: "crit", label: "Critical Strike", group: "Attack" },
    { id: "lifesteal", label: "Life Steal", group: "Attack" },
    { id: "armorpen", label: "Armor Pen", group: "Attack" },
    { id: "ap", label: "Ability Power", group: "Magic" },
    { id: "mana", label: "Mana", group: "Magic" },
    { id: "haste", label: "Ability Haste", group: "Magic" },
    { id: "magicpen", label: "Magic Pen", group: "Magic" },
    { id: "hp", label: "Health", group: "Defense" },
    { id: "armor", label: "Armor", group: "Defense" },
    { id: "mr", label: "Magic Resist", group: "Defense" },
    { id: "hpregen", label: "Health Regen", group: "Defense" },
    { id: "boots", label: "Boots", group: "Movement" },
    { id: "movement", label: "Other Movement", group: "Movement" },
    { id: "owned", label: "Owned", group: "Bag" },
    { id: "studio", label: "Studio thumbs", group: "Bag" },
  ];
  var ALL_SECTIONS = [
    "start",
    "tools",
    "boots",
    "ad",
    "as",
    "crit",
    "lifesteal",
    "armorpen",
    "ap",
    "mana",
    "haste",
    "magicpen",
    "hp",
    "armor",
    "mr",
    "hpregen",
    "movement",
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function teamColor(t) {
    return t === "blue" ? "#3aa0ff" : "#e24b4b";
  }

  function makeChamp(team, x, y, bot) {
    return {
      kind: "champ",
      team: team,
      x: x,
      y: y,
      tx: x,
      ty: y,
      hp: 620,
      maxHp: 620,
      mana: 340,
      maxMana: 340,
      ad: 68,
      ap: 0,
      as: 0.72,
      range: 280,
      speed: 380,
      level: 1,
      xp: 0,
      atkCd: 0,
      dead: 0,
      bot: !!bot,
      name: team === "blue" ? "Sevin" : "Rival",
      q: 0,
      w: 0,
      e: 0,
      r: 0,
      inv: [],
      armor: 0,
      mr: 0,
      recall: 0,
      recallMax: 8,
      recallX: x,
      recallY: y,
    };
  }

  var BASE_STATS = {
    maxHp: 620,
    maxMana: 340,
    ad: 68,
    ap: 0,
    as: 0.72,
    armor: 0,
    mr: 0,
    speed: 380,
  };

  function applyLoadout() {
    if (!player) return;
    var hpRatio = player.maxHp ? player.hp / player.maxHp : 1;
    var mpRatio = player.maxMana ? player.mana / player.maxMana : 1;
    player.maxHp = BASE_STATS.maxHp;
    player.maxMana = BASE_STATS.maxMana;
    player.ad = BASE_STATS.ad;
    player.ap = BASE_STATS.ap;
    player.as = BASE_STATS.as;
    player.armor = BASE_STATS.armor;
    player.mr = BASE_STATS.mr;
    player.speed = BASE_STATS.speed;
    (player.inv || []).forEach(function (id) {
      var it = itemsById[id];
      if (!it) return;
      player.ad += it.ad || 0;
      player.ap += it.ap || 0;
      player.maxHp += it.hp || 0;
      player.as += it.as || 0;
      player.armor += it.armor || 0;
      player.mr += it.mr || 0;
      player.maxMana += it.mana || 0;
      player.speed += (it.ms || 0) * 2;
    });
    player.hp = Math.min(player.maxHp, Math.max(1, player.maxHp * hpRatio));
    player.mana = Math.min(player.maxMana, player.maxMana * mpRatio);
  }

  function makeTower(team, x, y, hp) {
    return {
      kind: "tower",
      team: team,
      x: x,
      y: y,
      hp: hp || 2200,
      maxHp: hp || 2200,
      ad: 150,
      range: 420,
      atkCd: 0,
      dead: 0,
      speed: 0,
    };
  }

  function makeNexus(team, x, y) {
    return {
      kind: "nexus",
      team: team,
      x: x,
      y: y,
      hp: 3500,
      maxHp: 3500,
      ad: 0,
      range: 0,
      atkCd: 0,
      dead: 0,
      speed: 0,
    };
  }

  function makeMinion(team, x, y, lane, role) {
    role = role || "melee";
    var spec =
      role === "cannon"
        ? { hp: 640, ad: 44, range: 150, speed: 232, gold: 48, as: 0.58 }
        : role === "caster"
          ? { hp: 190, ad: 30, range: 230, speed: 248, gold: 14, as: 0.72 }
          : { hp: 300, ad: 24, range: 72, speed: 258, gold: 21, as: 0.9 };
    return {
      kind: "minion",
      team: team,
      role: role,
      x: x,
      y: y,
      tx: x,
      ty: y,
      hp: spec.hp,
      maxHp: spec.hp,
      ad: spec.ad,
      range: spec.range,
      speed: spec.speed,
      as: spec.as,
      atkCd: 0,
      dead: 0,
      lane: lane,
      gold: spec.gold,
      wp: 0,
      facing: team === "blue" ? -0.8 : 2.4,
    };
  }

  function waypoints(team, lane) {
    var blue = team === "blue";
    if (lane === "mid") {
      return blue
        ? [
            [900, 8700],
            [2500, 7100],
            [4000, 5600],
            [5600, 4000],
            [7100, 2500],
            [8700, 900],
          ]
        : [
            [8700, 900],
            [7100, 2500],
            [5600, 4000],
            [4000, 5600],
            [2500, 7100],
            [900, 8700],
          ];
    }
    if (lane === "top") {
      return blue
        ? [
            [700, 8600],
            [700, 6200],
            [700, 3800],
            [700, 900],
            [3200, 700],
            [5800, 700],
            [8700, 700],
          ]
        : [
            [8700, 700],
            [5800, 700],
            [3200, 700],
            [700, 700],
            [700, 3800],
            [700, 6200],
            [700, 8600],
          ];
    }
    return blue
      ? [
          [1100, 8900],
          [3400, 8900],
          [5800, 8900],
          [8700, 8900],
          [8900, 6200],
          [8900, 3800],
          [8900, 900],
        ]
      : [
          [8900, 900],
          [8900, 3800],
          [8900, 6200],
          [8900, 8900],
          [5800, 8900],
          [3400, 8900],
          [1100, 8900],
        ];
  }

  var LANE_GATES = [
    { x: 700, y: 7600, facing: "ns", team: "blue" },
    { x: 700, y: 5200, facing: "ns", team: "blue" },
    { x: 700, y: 2600, facing: "ns", team: "red" },
    { x: 2600, y: 700, facing: "ew", team: "blue" },
    { x: 5200, y: 700, facing: "ew", team: "red" },
    { x: 7600, y: 700, facing: "ew", team: "red" },
    { x: 2500, y: 8900, facing: "ew", team: "blue" },
    { x: 5000, y: 8900, facing: "ew", team: "blue" },
    { x: 7600, y: 8900, facing: "ew", team: "red" },
    { x: 8900, y: 7600, facing: "ns", team: "red" },
    { x: 8900, y: 5000, facing: "ns", team: "red" },
    { x: 8900, y: 2400, facing: "ns", team: "red" },
    { x: 2100, y: 7500, facing: "diag", team: "blue" },
    { x: 4000, y: 5600, facing: "diag", team: "neutral" },
    { x: 5600, y: 4000, facing: "diag", team: "neutral" },
    { x: 7500, y: 2100, facing: "diag", team: "red" },
  ];

  var BLUE_WALLS = [
    [1480, 4520, 2100, 72],
    [1480, 4520, 72, 1880],
    [3508, 4520, 72, 980],
    [1480, 6328, 1280, 72],
    [2100, 5280, 980, 64],
    [2100, 5280, 64, 720],
    [2680, 5940, 820, 64],
    [1760, 5600, 64, 520],
    [3000, 6800, 720, 64],
    [3000, 6800, 64, 640],
    [1680, 7200, 1380, 64],
    [1680, 6680, 64, 584],
    [2360, 5000, 64, 280],
  ];
  var WALLS = BLUE_WALLS.concat(
    BLUE_WALLS.map(function (w) {
      return [W - w[0] - w[2], H - w[1] - w[3], w[2], w[3]];
    })
  );

  function hitsWall(x, y, r) {
    r = r || 16;
    var i;
    var w;
    for (i = 0; i < WALLS.length; i++) {
      w = WALLS[i];
      if (x + r > w[0] && x - r < w[0] + w[2] && y + r > w[1] && y - r < w[1] + w[3]) return true;
    }
    return false;
  }

  function makeInhib(team, x, y) {
    return {
      kind: "inhibitor",
      team: team,
      x: x,
      y: y,
      hp: 2800,
      maxHp: 2800,
      ad: 0,
      range: 0,
      atkCd: 0,
      dead: 0,
      speed: 0,
    };
  }

  function makeCamp(name, x, y, hp, gold, shape) {
    return {
      kind: "camp",
      team: "neutral",
      name: name,
      shape: shape || "beast",
      x: x,
      y: y,
      tx: x,
      ty: y,
      hp: hp,
      maxHp: hp,
      ad: 28,
      range: 90,
      speed: 0,
      atkCd: 0,
      dead: 0,
      gold: gold,
      respawn: 75,
    };
  }

  function makeBoss(name, x, y, hp, gold, shape) {
    return {
      kind: "boss",
      team: "neutral",
      name: name,
      shape: shape || "dragon",
      x: x,
      y: y,
      tx: x,
      ty: y,
      hp: hp,
      maxHp: hp,
      ad: 85,
      range: 160,
      speed: 40,
      atkCd: 0,
      dead: 0,
      gold: gold,
      respawn: 240,
    };
  }

  function spawnJungle() {
    [
      ["Blue Sentinel", 1880, 5180, 920, 72, "buff"],
      ["Murk Wolves", 2760, 4980, 640, 48, "wolves"],
      ["Gromp", 1720, 5980, 780, 58, "gromp"],
      ["Raptors", 3380, 6180, 700, 52, "raptors"],
      ["Red Bramble", 3040, 7040, 980, 78, "buff"],
      ["Krugs", 2360, 7580, 860, 62, "krugs"],
      ["Blue Sentinel", W - 1880, H - 5180, 920, 72, "buff"],
      ["Murk Wolves", W - 2760, H - 4980, 640, 48, "wolves"],
      ["Gromp", W - 1720, H - 5980, 780, 58, "gromp"],
      ["Raptors", W - 3380, H - 6180, 700, 52, "raptors"],
      ["Red Bramble", W - 3040, H - 7040, 980, 78, "buff"],
      ["Krugs", W - 2360, H - 7580, 860, 62, "krugs"],
    ].forEach(function (c) {
      units.push(makeCamp(c[0], c[1], c[2], c[3], c[4], c[5]));
    });
    units.push(makeBoss("Elder Wyrm", 5220, 6380, 3200, 220, "dragon"));
    units.push(makeBoss("Abyssal Baron", 4380, 3220, 3800, 260, "baron"));
  }

  function reset() {
    gold = 500;
    kda = [0, 0, 0];
    spawnT = 0;
    ended = "";
    shots = [];
    units = [];
    player = makeChamp("blue", 720, 8880, false);
    units.push(player);
    units.push(makeChamp("red", 8880, 720, true));
    units.push(makeChamp("red", 8600, 980, true));
    units.push(makeChamp("red", 8400, 1200, true));
    units.push(makeChamp("red", 8200, 1500, true));
    units.push(makeNexus("blue", 560, 9040));
    units.push(makeNexus("red", 9040, 560));
    units.push(makeInhib("blue", 720, 8040));
    units.push(makeInhib("blue", 1680, 8120));
    units.push(makeInhib("blue", 2040, 8880));
    units.push(makeInhib("red", W - 720, H - 8040));
    units.push(makeInhib("red", W - 1680, H - 8120));
    units.push(makeInhib("red", W - 2040, H - 8880));
    spawnJungle();
    var spots = [
      ["blue", 720, 7200, 2400],
      ["blue", 720, 4800, 2600],
      ["blue", 900, 2200, 3000],
      ["blue", 2800, 8900, 2400],
      ["blue", 5200, 8900, 2600],
      ["blue", 7400, 8900, 3000],
      ["blue", 2400, 7200, 2400],
      ["blue", 3600, 6000, 2600],
      ["blue", 1400, 8400, 3200],
      ["blue", 1100, 8700, 3200],
      ["red", 8880, 2400, 2400],
      ["red", 8880, 4800, 2600],
      ["red", 8700, 7400, 3000],
      ["red", 6800, 700, 2400],
      ["red", 4400, 700, 2600],
      ["red", 2200, 700, 3000],
      ["red", 7200, 2400, 2400],
      ["red", 6000, 3600, 2600],
      ["red", 8200, 1200, 3200],
      ["red", 8500, 900, 3200],
    ];
    spots.forEach(function (s) {
      units.push(makeTower(s[0], s[1], s[2], s[3]));
    });
    cam.x = player.x;
    cam.y = player.y;
    waveN = 0;
    spawnT = 12;
    spawnWave();
  }

  function spawnWave() {
    waveN += 1;
    ["top", "mid", "bot"].forEach(function (lane) {
      var i;
      for (i = 0; i < 3; i++) {
        units.push(makeMinion("blue", 780 + i * 30, 8820 + i * 18, lane, "melee"));
        units.push(makeMinion("red", 8820 - i * 30, 780 - i * 18, lane, "melee"));
      }
      units.push(makeMinion("blue", 860, 8740, lane, "caster"));
      units.push(makeMinion("red", 8740, 860, lane, "caster"));
      if (waveN % 3 === 0) {
        units.push(makeMinion("blue", 740, 8880, lane, "cannon"));
        units.push(makeMinion("red", 8880, 740, lane, "cannon"));
      }
    });
  }

  function alive(u) {
    return u && u.dead <= 0 && u.hp > 0;
  }

  function enemies(u) {
    return units.filter(function (o) {
      if (!alive(o) || o.team === u.team) return false;
      if (u.kind === "minion" && (o.kind === "camp" || o.kind === "boss")) return false;
      if ((u.kind === "camp" || u.kind === "boss") && o.kind === "minion") return false;
      return true;
    });
  }

  function nearest(u, list, max) {
    var best = null;
    var bestD = max || 1e9;
    list.forEach(function (o) {
      var d = dist(u, o);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    });
    return best;
  }

  function inFountain(u) {
    if (u.team === "blue") return u.x < 1600 && u.y > 8000;
    return u.x > 8000 && u.y < 1600;
  }

  function startRecall() {
    if (!player || !alive(player) || ended) return;
    if (inFountain(player)) {
      toast("Already at the pool.");
      setShopOpen(true);
      return;
    }
    if (player.recall > 0) return;
    player.recall = 8;
    player.recallMax = 8;
    player.recallX = player.x;
    player.recallY = player.y;
    player.tx = player.x;
    player.ty = player.y;
    toast("Recalling to summoner pool…");
  }

  function cancelRecall(why) {
    if (!player || player.recall <= 0) return;
    player.recall = 0;
    toast(why || "Recall interrupted");
  }

  function finishRecall() {
    player.x = player.tx = 830;
    player.y = player.ty = 8760;
    player.hp = player.maxHp;
    player.mana = player.maxMana;
    player.recall = 0;
    cam.x = player.x;
    cam.y = player.y;
    toast("Summoner pool — heal and shop");
    setShopOpen(true);
  }

  function deal(src, dst, amt) {
    if (!alive(dst)) return;
    dst.hp -= amt;
    if (dst === player) cancelRecall("Recall interrupted");
    if (dst.hp <= 0) {
      dst.hp = 0;
      dst.dead = dst.kind === "champ" ? 8 : 99;
      if (dst.kind === "nexus") {
        var inhibUp = units.some(function (o) {
          return o.kind === "inhibitor" && o.team === dst.team && alive(o);
        });
        if (inhibUp) {
          dst.hp = Math.max(1, dst.hp);
          dst.dead = 0;
          if (src === player) toast("Kill inhibitors first.");
          return;
        }
      }
      if (src === player) {
        gold += dst.kind === "champ" ? 300 : dst.gold || 40;
        if (dst.kind === "champ") kda[0] += 1;
        if (dst.kind === "boss") toast(dst.name + " slain");
      }
      if (dst === player) kda[1] += 1;
      if (dst.kind === "nexus") ended = src.team === "blue" ? "VICTORY" : "DEFEAT";
      if ((dst.kind === "camp" || dst.kind === "boss") && dst.respawn) {
        dst.dead = dst.respawn;
      }
    }
  }

  function fire(src, tx, ty, dmg, speed, col, life) {
    var a = Math.atan2(ty - src.y, tx - src.x);
    shots.push({
      x: src.x,
      y: src.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      team: src.team,
      dmg: dmg,
      col: col,
      life: life || 0.9,
      r: 7,
    });
  }

  function tryAttack(u, dt) {
    var foe = nearest(u, enemies(u), u.range + 8);
    if (!foe) return false;
    if (dist(u, foe) > u.range) return false;
    u.atkCd -= dt;
    if (u.atkCd > 0) return true;
    u.atkCd = 1 / (u.as || 0.7);
    deal(u, foe, u.ad);
    return true;
  }

  function followLane(u) {
    var pts = waypoints(u.team, u.lane || "mid");
    if (!pts.length) return;
    if (u.wp == null || u.wp < 0) u.wp = 0;
    if (u.wp > pts.length - 1) u.wp = pts.length - 1;
    var i;
    var bestI = u.wp;
    var bestD = Math.hypot(u.x - pts[u.wp][0], u.y - pts[u.wp][1]);
    for (i = u.wp; i < pts.length; i++) {
      var d = Math.hypot(u.x - pts[i][0], u.y - pts[i][1]);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    u.wp = bestI;
    if (bestD < 150 && u.wp < pts.length - 1) u.wp += 1;
    u.tx = pts[u.wp][0];
    u.ty = pts[u.wp][1];
  }

  function separateMinions(u) {
    var j;
    for (j = 0; j < units.length; j++) {
      var o = units[j];
      if (o === u || o.kind !== "minion" || o.team !== u.team || !alive(o)) continue;
      var dx = u.x - o.x;
      var dy = u.y - o.y;
      var d = Math.hypot(dx, dy);
      if (d > 0.5 && d < 26) {
        var push = ((26 - d) / 26) * 1.4;
        u.x += (dx / d) * push;
        u.y += (dy / d) * push;
      }
    }
  }

  function moveToward(u, tx, ty, dt) {
    var d = Math.hypot(tx - u.x, ty - u.y);
    if (d < 4) return;
    var sp = (u.speed || 0) * dt;
    var nx = u.x + ((tx - u.x) / d) * sp;
    var ny = u.y + ((ty - u.y) / d) * sp;
    u.facing = Math.atan2(ty - u.y, tx - u.x);
    if (u.kind === "minion") {
      u.x = nx;
      u.y = ny;
      separateMinions(u);
      return;
    }
    var rad = u.kind === "champ" ? 16 : 12;
    if (!hitsWall(nx, ny, rad)) {
      u.x = nx;
      u.y = ny;
    } else if (!hitsWall(nx, u.y, rad)) {
      u.x = nx;
    } else if (!hitsWall(u.x, ny, rad)) {
      u.y = ny;
    }
  }

  function botThink(u) {
    var foe = nearest(u, enemies(u), 480);
    if (foe && dist(u, foe) < 420) {
      if (dist(u, foe) > u.range * 0.85) {
        u.tx = foe.x;
        u.ty = foe.y;
      } else {
        u.tx = u.x;
        u.ty = u.y;
      }
      return;
    }
    followLane(u);
  }

  function cast(which) {
    if (!alive(player) || ended) return;
    cancelRecall("Recall interrupted");
    var mx = mouse.worldX;
    var my = mouse.worldY;
    if (which === "q" && player.q <= 0 && player.mana >= 40) {
      player.q = 5;
      player.mana -= 40;
      fire(player, mx, my, 80 + player.ap * 0.6, 900, "#5ef0e8", 1.1);
    }
    if (which === "w" && player.w <= 0 && player.mana >= 50) {
      player.w = 8;
      player.mana -= 50;
      var a = Math.atan2(my - player.y, mx - player.x);
      player.x += Math.cos(a) * 380;
      player.y += Math.sin(a) * 380;
      player.tx = player.x;
      player.ty = player.y;
    }
    if (which === "e" && player.e <= 0 && player.mana >= 50) {
      player.e = 9;
      player.mana -= 50;
      enemies(player).forEach(function (o) {
        if (dist(player, o) < 320) deal(player, o, 55 + player.ap * 0.35);
      });
    }
    if (which === "r" && player.r <= 0 && player.mana >= 80) {
      player.r = 40;
      player.mana -= 80;
      enemies(player).forEach(function (o) {
        if (dist(player, o) < 420) deal(player, o, 180 + player.ap);
      });
    }
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    return path;
  }

  function itemIcon(it) {
    if (!it) return "";
    var src = it.icon || it.temp || "";
    var v = String(it.regen_count || 0) + "-" + String(it.updated_at || "");
    return src + (src.indexOf("?") >= 0 ? "&" : "?") + "v=" + encodeURIComponent(v);
  }

  function itemRank(it) {
    var id = parseInt(it.id, 10) || 0;
    var s = 0;
    if (it.source === "studio") s += 100000;
    if (it.purchasable) s += 5000;
    if (it.maps_sr) s += 4000;
    if (id > 0 && id < 10000) s += 3000;
    else if (id < 20000) s += 1500;
    if ((it.from || []).length) s += 80;
    s -= id / 1e6;
    return s;
  }

  function dedupeByName(list) {
    var best = {};
    (list || []).forEach(function (it) {
      var key = String(it.name || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      if (!key) return;
      if (!best[key] || itemRank(it) > itemRank(best[key])) best[key] = it;
    });
    return Object.keys(best)
      .map(function (k) {
        return best[k];
      })
      .sort(function (a, b) {
        return (a.cost || 0) - (b.cost || 0) || String(a.name).localeCompare(String(b.name));
      });
  }

  function hasTag(it, names) {
    var tags = (it.tags || []).map(function (t) {
      return String(t).toLowerCase();
    });
    return names.some(function (n) {
      return tags.indexOf(String(n).toLowerCase()) >= 0;
    });
  }

  function isComponent(it) {
    if (!it) return false;
    if (hasTag(it, ["Consumable", "Trinket", "Vision"])) return false;
    var into = it.into || [];
    if (!into.length) return false;
    if ((it.from || []).length && (it.cost || 0) >= 2000) return false;
    return true;
  }

  function isCompletedItem(it) {
    if (!it) return false;
    if (hasTag(it, ["Consumable", "Trinket", "Vision", "GoldPer"])) return false;
    if (hasTag(it, ["Lane", "Jungle"]) && (it.cost || 0) <= 900 && !(it.from || []).length) {
      return false;
    }
    return !isComponent(it);
  }

  function canonicalById(id) {
    var raw = itemsById[String(id)];
    if (!raw) return null;
    var list = dedupeByName(
      catalogItems.filter(function (it) {
        return it.purchasable && it.maps_sr;
      })
    );
    var hit = list.filter(function (it) {
      return it.name === raw.name;
    })[0];
    return hit || raw;
  }

  function itemInCat(it, catId) {
    if (!it) return false;
    if (catId === "all") return true;
    if (catId === "items") return isCompletedItem(it);
    if (catId === "components") return isComponent(it);
    if (catId === "owned") return !!(player && player.inv.indexOf(it.id) >= 0);
    if (catId === "studio") return it.source === "studio";
    if (catId === "transforms") return !it.purchasable && (it.cost || 0) > 0;
    if (catId === "start") {
      return hasTag(it, ["Lane", "Jungle"]) && (it.cost || 0) <= 900 && !(it.from || []).length;
    }
    if (catId === "tools") return hasTag(it, ["Consumable", "Trinket", "Vision", "GoldPer"]);
    if (catId === "ad") return hasTag(it, ["Damage"]) || it.ad > 0;
    if (catId === "as") return hasTag(it, ["AttackSpeed"]) || it.as > 0;
    if (catId === "crit") return hasTag(it, ["CriticalStrike"]) || it.crit > 0;
    if (catId === "lifesteal") return hasTag(it, ["LifeSteal", "SpellVamp"]);
    if (catId === "armorpen") return hasTag(it, ["ArmorPenetration"]);
    if (catId === "ap") return hasTag(it, ["SpellDamage"]) || it.ap > 0;
    if (catId === "mana") return hasTag(it, ["Mana", "ManaRegen"]) || it.mana > 0;
    if (catId === "haste") return hasTag(it, ["AbilityHaste", "CooldownReduction"]);
    if (catId === "magicpen") return hasTag(it, ["MagicPenetration"]);
    if (catId === "hp") return hasTag(it, ["Health"]) || it.hp > 0;
    if (catId === "armor") return hasTag(it, ["Armor"]) || it.armor > 0;
    if (catId === "mr") return hasTag(it, ["SpellBlock", "MagicResist"]) || it.mr > 0;
    if (catId === "hpregen") return hasTag(it, ["HealthRegen"]);
    if (catId === "boots") return hasTag(it, ["Boots"]) || /boot/i.test(it.name || "");
    if (catId === "movement") return hasTag(it, ["NonbootsMovement"]) || (!!it.ms && !hasTag(it, ["Boots"]));
    return true;
  }

  function primaryCat(it) {
    var i;
    for (i = 0; i < ALL_SECTIONS.length; i++) {
      if (itemInCat(it, ALL_SECTIONS[i])) return ALL_SECTIONS[i];
    }
    return "other";
  }

  function catLabel(id) {
    var row = SHOP_CATS.filter(function (c) {
      return c.id === id;
    })[0];
    return (row && row.label) || id;
  }

  function junkName(name) {
    name = String(name || "");
    if (!name.trim() || name.indexOf("<") >= 0) return true;
    var low = name.toLowerCase();
    if (low.indexOf("healthbar") === 0) return true;
    if (low.indexOf("structure bounty") >= 0) return true;
    if (name === "Recall" || name === "Disabled Recall") return true;
    return false;
  }

  function inShopBook(it) {
    if (!it || junkName(it.name)) return false;
    var id = parseInt(it.id, 10) || 0;
    if (id >= 1500 && id <= 1599) return false;
    if (it.maps_sr && ((it.cost || 0) > 0 || it.purchasable)) return true;
    if (id < 10000 && it.purchasable && (it.cost || 0) >= 400) return true;
    return false;
  }

  function uniquePool() {
    var src = catalogItems;
    if (shopCat === "owned") {
      src = catalogItems.filter(function (it) {
        return player && player.inv.indexOf(it.id) >= 0;
      });
    } else if (shopCat === "studio") {
      src = catalogItems.filter(function (it) {
        return it.source === "studio";
      });
    } else {
      src = catalogItems.filter(inShopBook);
    }
    return dedupeByName(src);
  }

  function applyItem(it) {
    if (!player || !it) return;
    if ((player.inv || []).length >= 6) {
      toast("Inventory full — 6 items.");
      return false;
    }
    player.inv.push(it.id);
    applyLoadout();
    renderInv();
    return true;
  }

  function sellSlot(slot) {
    if (!player || !player.inv) return;
    if (!inFountain(player)) {
      toast("Sell in fountain.");
      return;
    }
    var id = player.inv[slot];
    if (!id) return;
    var it = itemsById[id];
    gold += (it && (it.sell || Math.floor((it.cost || 0) * 0.7))) || 0;
    player.inv.splice(slot, 1);
    applyLoadout();
    renderInv();
    toast("Sold " + ((it && it.name) || "item"));
  }

  function buy(id) {
    if (!inFountain(player)) {
      toast("Shop in fountain.");
      return;
    }
    var it = itemsById[id] || itemsById[selectedId];
    if (!it) return;
    if (!it.purchasable) {
      toast("Not sold in fountain — transform / quest identity.");
      return;
    }
    if ((player.inv || []).length >= 6) {
      toast("Inventory full — 6 items.");
      return;
    }
    if (gold < (it.cost || 0)) {
      toast("Need " + it.cost + "g");
      return;
    }
    gold -= it.cost || 0;
    applyItem(it);
    toast("Bought " + it.name);
    renderShop();
  }

  function renderInv() {
    var i;
    for (i = 0; i < 6; i++) {
      var slot = $("mb-inv-" + i);
      if (!slot) continue;
      var id = player && player.inv ? player.inv[i] : null;
      var it = id ? itemsById[id] : null;
      slot.classList.toggle("filled", !!it);
      slot.title = it ? it.name + " — click to inspect, right-click sell in fountain" : "Empty item slot";
      slot.style.backgroundImage = it ? "url(\"" + itemIcon(it) + "\")" : "";
      slot.textContent = it ? "" : String(i + 1);
    }
  }

  function shopStatus(msg) {
    var el = $("mb-shop-status");
    if (el) el.textContent = msg || "";
  }

  function selectItem(id) {
    selectedId = String(id || "");
    var it = itemsById[selectedId];
    var detail = $("mb-shop-detail");
    if (!it) {
      if (detail) detail.hidden = true;
      return;
    }
    if (detail) detail.hidden = false;
    var icon = $("mb-shop-icon");
    if (icon) icon.src = itemIcon(it);
    if ($("mb-shop-name")) $("mb-shop-name").textContent = it.name;
    if ($("mb-shop-cost")) $("mb-shop-cost").textContent = (it.cost || 0) + "g";
    if ($("mb-shop-id")) {
      $("mb-shop-id").textContent =
        "id " + it.id + " · " + (it.source === "studio" ? "studio identity" : "temp icon") +
        (it.regen_count ? " · regen ×" + it.regen_count : "");
    }
    var bits = [];
    if (it.ad) bits.push("+" + it.ad + " AD");
    if (it.ap) bits.push("+" + it.ap + " AP");
    if (it.hp) bits.push("+" + it.hp + " HP");
    if (it.as) bits.push("+" + Math.round(it.as * 100) + "% AS");
    if (it.armor) bits.push("+" + it.armor + " Armor");
    if (it.mr) bits.push("+" + it.mr + " MR");
    if (it.mana) bits.push("+" + it.mana + " Mana");
    if (it.ms) bits.push("+" + it.ms + " MS");
    if (it.crit) bits.push("+" + Math.round(it.crit * 100) + "% Crit");
    if ($("mb-shop-stats")) $("mb-shop-stats").textContent = bits.join(" · ") || "Passive / special";
    if ($("mb-shop-desc")) $("mb-shop-desc").textContent = it.plaintext || it.description || "";
    var lookEl = $("mb-shop-look");
    if (lookEl) {
      var look = it.look || {};
      lookEl.textContent = look.description
        ? look.description + (look.prompt ? "\n\nCast prompt: " + look.prompt : "")
        : "No look yet — Describe look reads the icon the same way Transfer does.";
    }
    if ($("mb-shop-alter")) $("mb-shop-alter").value = it.alter || "";
    renderRecipe(it);
    shopStatus("");
    markSelected();
    updateShopPlace();
  }

  function renderRecipe(it) {
    var hold = $("mb-shop-recipe");
    if (!hold) return;
    hold.innerHTML = "";
    var kind = document.createElement("p");
    kind.className = "mb-shop-kind";
    kind.textContent = isComponent(it) ? "Component" : isCompletedItem(it) ? "Item" : "Starter / tool";
    hold.appendChild(kind);
    function row(label, ids) {
      var parts = [];
      (ids || []).forEach(function (id) {
        var rowIt = canonicalById(id);
        if (rowIt && parts.indexOf(rowIt) < 0) parts.push(rowIt);
      });
      if (!parts.length) return;
      var wrap = document.createElement("div");
      wrap.className = "mb-recipe-row";
      var lab = document.createElement("span");
      lab.textContent = label;
      wrap.appendChild(lab);
      parts.forEach(function (comp) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "mb-recipe-icon";
        b.title = comp.name + " · " + (comp.cost || 0) + "g";
        var img = document.createElement("img");
        img.src = itemIcon(comp);
        img.alt = comp.name;
        b.appendChild(img);
        b.addEventListener("click", function () {
          selectItem(comp.id);
        });
        wrap.appendChild(b);
      });
      hold.appendChild(wrap);
    }
    row("Builds from", it.from);
    row("Builds into", it.into);
  }

  function markSelected() {
    var grid = $("mb-shop-grid");
    if (!grid) return;
    grid.querySelectorAll(".mb-shop-item").forEach(function (b) {
      b.classList.toggle("selected", b.dataset.id === selectedId);
    });
  }

  function setShopOpen(on) {
    shopOpen = !!on;
    var sh = $("mb-shop");
    if (sh) sh.hidden = !shopOpen;
    document.body.classList.toggle("mb-shop-open", shopOpen);
    var tog = $("mb-shop-toggle");
    if (tog) tog.textContent = shopOpen ? "Close shop (P)" : "Shop (P)";
    if (shopOpen) {
      renderShop();
      updateShopPlace();
    }
  }

  function updateShopPlace() {
    var el = $("mb-shop-place");
    if (!el) return;
    if (player && inFountain(player)) el.textContent = "In fountain — buy enabled";
    else el.textContent = "Browse anywhere · buy in fountain";
  }

  function makeItemCard(it) {
    var b = document.createElement("button");
    b.type = "button";
    b.className =
      "mb-shop-item" +
      (it.id === selectedId ? " selected" : "") +
      (it.source === "studio" ? " studio" : "") +
      (isComponent(it) ? " component" : "");
    b.title = it.name + " · id " + it.id;
    b.dataset.id = it.id;
    var img = document.createElement("img");
    img.alt = it.name;
    img.loading = "lazy";
    img.src = itemIcon(it);
    b.appendChild(img);
    var name = document.createElement("span");
    name.className = "mb-shop-iname";
    name.textContent = it.name;
    b.appendChild(name);
    var ident = document.createElement("span");
    ident.className = "mb-shop-iid";
    ident.textContent =
      (isComponent(it) ? "component" : "item") +
      " · " +
      (it.source === "studio" ? "studio" : "temp");
    b.appendChild(ident);
    var g = document.createElement("span");
    g.className = "mb-g";
    g.textContent = (it.cost || 0) + "g";
    b.appendChild(g);
    b.addEventListener("click", function () {
      selectItem(it.id);
    });
    b.addEventListener("dblclick", function () {
      buy(it.id);
    });
    return b;
  }

  function appendSection(parent, title, items) {
    if (!items.length) return;
    var sec = document.createElement("section");
    sec.className = "mb-shop-section";
    var h = document.createElement("h4");
    h.textContent = title + " · " + items.length;
    sec.appendChild(h);
    var cards = document.createElement("div");
    cards.className = "mb-shop-cards";
    items.forEach(function (it) {
      cards.appendChild(makeItemCard(it));
    });
    sec.appendChild(cards);
    parent.appendChild(sec);
  }

  function renderShopCats() {
    var nav = $("mb-shop-cats");
    if (!nav || nav.dataset.bound) return;
    nav.dataset.bound = "1";
    var lastGroup = null;
    SHOP_CATS.forEach(function (cat) {
      if (cat.group && cat.group !== lastGroup) {
        var g = document.createElement("p");
        g.className = "mb-shop-cat-group";
        g.textContent = cat.group;
        nav.appendChild(g);
        lastGroup = cat.group;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mb-shop-cat" + (shopCat === cat.id ? " active" : "");
      b.dataset.cat = cat.id;
      b.textContent = cat.label;
      b.addEventListener("click", function () {
        shopCat = cat.id;
        nav.querySelectorAll(".mb-shop-cat").forEach(function (el) {
          el.classList.toggle("active", el.dataset.cat === shopCat);
        });
        renderShop();
      });
      nav.appendChild(b);
    });
  }

  function renderShop() {
    var grid = $("mb-shop-grid");
    if (!grid) return;
    renderShopCats();
    var pool = uniquePool();
    var q = shopQuery.toLowerCase();
    var searched = pool.filter(function (it) {
      if (!q) return true;
      return (
        String(it.name || "").toLowerCase().indexOf(q) >= 0 ||
        String(it.id).indexOf(q) >= 0
      );
    });
    var list =
      shopCat === "all"
        ? searched
        : searched.filter(function (it) {
            return itemInCat(it, shopCat);
          });
    if ($("mb-shop-count")) {
      $("mb-shop-count").textContent = list.length + " unique";
    }
    grid.innerHTML = "";
    function byPrimary(rows, id) {
      return rows.filter(function (it) {
        return primaryCat(it) === id;
      });
    }
    function splitAndAppend(rows, heading) {
      var completed = rows.filter(isCompletedItem);
      var comps = rows.filter(isComponent);
      var rest = rows.filter(function (it) {
        return !isCompletedItem(it) && !isComponent(it);
      });
      if (heading) {
        var band = document.createElement("h3");
        band.className = "mb-shop-band";
        band.textContent = heading;
        grid.appendChild(band);
      }
      appendSection(grid, "Items", completed);
      appendSection(grid, "Components", comps);
      if (rest.length) appendSection(grid, "Other", rest);
    }
    if (shopCat === "all" && !q) {
      appendSection(
        grid,
        "Start",
        searched.filter(function (it) {
          return itemInCat(it, "start");
        })
      );
      appendSection(
        grid,
        "Tools",
        searched.filter(function (it) {
          return itemInCat(it, "tools");
        })
      );
      var bandI = document.createElement("h3");
      bandI.className = "mb-shop-band";
      bandI.textContent = "Items";
      grid.appendChild(bandI);
      ALL_SECTIONS.forEach(function (id) {
        if (id === "start" || id === "tools") return;
        appendSection(
          grid,
          catLabel(id),
          byPrimary(searched, id).filter(isCompletedItem)
        );
      });
      var bandC = document.createElement("h3");
      bandC.className = "mb-shop-band";
      bandC.textContent = "Components";
      grid.appendChild(bandC);
      ALL_SECTIONS.forEach(function (id) {
        if (id === "start" || id === "tools") return;
        appendSection(
          grid,
          catLabel(id),
          byPrimary(searched, id).filter(isComponent)
        );
      });
      appendSection(
        grid,
        "Other",
        searched.filter(function (it) {
          return primaryCat(it) === "other";
        })
      );
    } else if (
      shopCat === "items" ||
      shopCat === "components" ||
      shopCat === "start" ||
      shopCat === "tools" ||
      shopCat === "transforms"
    ) {
      appendSection(grid, catLabel(shopCat), list);
    } else {
      splitAndAppend(list, catLabel(shopCat));
    }
  }

  function ingestCatalog(data) {
    catalogItems = (data && data.items) || [];
    itemsById = {};
    catalogItems.forEach(function (it) {
      itemsById[String(it.id)] = it;
    });
    renderShop();
    if (selectedId && itemsById[selectedId]) selectItem(selectedId);
  }

  function loadItems() {
    return fetch(apiUrl("/api/moba-items"), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        ingestCatalog(d);
      })
      .catch(function () {
        catalogItems = [];
      });
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

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    var raw =
      (img && (img.url || img.download_url || img.uri)) ||
      payload.image_url ||
      payload.output_url ||
      "";
    return absUrl(raw);
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function showThumbPreview(url) {
    if (!url) return;
    var icon = $("mb-shop-icon");
    if (icon) icon.src = url;
    var card = document.querySelector('.mb-shop-item.selected img');
    if (card) card.src = url;
  }

  function setGenerateBusy(on) {
    regenBusy = !!on;
    var btn = $("mb-shop-regen");
    if (btn) {
      btn.disabled = !!on;
      btn.textContent = on ? "Generating…" : "Generate thumbnail";
    }
    var card = document.querySelector(".mb-shop-item.selected");
    if (card) card.classList.toggle("generating", !!on);
  }

  function gallerySpellNums() {
    var pool = [];
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getDisplayOrder === "function") {
        pool = window.SpellforgeAPI.getDisplayOrder() || [];
      }
    } catch (e) {}
    pool = (pool || []).filter(function (n) {
      n = parseInt(n, 10);
      return n >= 1 && n <= 1000;
    });
    if (!pool.length) {
      var i;
      for (i = 0; i < 8; i++) pool.push(1 + Math.floor(Math.random() * 1000));
    }
    var out = [];
    while (out.length < 2 && pool.length) {
      out.push(parseInt(pool.splice(Math.floor(Math.random() * pool.length), 1)[0], 10));
    }
    return out;
  }

  function itemGeneratePrompt(it, alter) {
    var look = it.look || {};
    var visual = String(look.prompt || look.description || "").replace(/\s+/g, " ").slice(0, 900);
    var role = String(it.description || it.plaintext || "").replace(/\s+/g, " ").slice(0, 400);
    var extra = String(alter || "").trim();
    return (
      "Square 1:1 inventory thumbnail of a single concrete object named " +
      it.name +
      ". Keep this object's identity and silhouette continuity. " +
      (visual ? "Original look: " + visual + " " : "") +
      (role ? "Game role: " + role + " " : "") +
      (extra
        ? "Spellforge-style manipulation — change form, material, era, or weather of THIS same object: " +
          extra +
          ". "
        : "") +
      "Centered on a dark simple field, readable at 64px, painterly gallery still, no champion, no hands, no text, no UI, no watermark."
    );
  }

  function pollImageJob(jobId, left) {
    if (left == null) left = 90;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for the new thumbnail."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        if (!res.ok && res.status === 404) {
          shopStatus("Starting generate job…");
          return delay(1200).then(function () {
            return pollImageJob(jobId, left - 1);
          });
        }
        var st = String(job.status || job.xai_status || "working").toLowerCase();
        shopStatus("Generating new thumbnail… " + st);
        var live = extractImageUrl(job);
        if (live) showThumbPreview(live);
        if (st === "done" || st === "completed" || st === "success" || st === "succeeded") {
          if (live) return live;
          throw new Error("Generate finished but no image URL came back.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Generate failed");
        }
        return delay(1500).then(function () {
          return pollImageJob(jobId, left - 1);
        });
      });
  }

  function saveIdentity(id, url) {
    var alter = ($("mb-shop-alter") && $("mb-shop-alter").value) || "";
    return fetch(apiUrl("/api/moba-items/" + encodeURIComponent(id) + "/save"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: url, alter: alter }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || d.ok === false) throw new Error((d && d.error) || "Save failed");
        var it = d.item;
        var prev = itemsById[it.id];
        if (prev && prev.look) it.look = prev.look;
        itemsById[it.id] = it;
        catalogItems = catalogItems.map(function (row) {
          return row.id === it.id ? it : row;
        });
        selectItem(it.id);
        return it;
      });
  }

  function regenerateSelected() {
    if (!selectedId || regenBusy) return;
    var it = itemsById[selectedId];
    if (!it) return;
    var alter = ($("mb-shop-alter") && $("mb-shop-alter").value) || "";
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "moba-item-" + Date.now();
    var prompt = itemGeneratePrompt(it, alter);
    var spells = gallerySpellNums();
    var ref = absUrl(it.icon || it.temp || "");
    setGenerateBusy(true);
    shopStatus("Generating a new thumbnail for " + it.name + "…");
    var body = {
      job_id: jobId,
      stasis: prompt.slice(0, 4000),
      prompt: prompt.slice(0, 4000),
      fused_prompt: prompt.slice(0, 4000),
      buzz_words: ["item icon", "inventory thumbnail", "single object", "square", "painterly", "identity"],
      spells: spells,
      aspect_ratio: "1:1",
      mag_fresh: false,
      fresh_variation: false,
      spell_cast: true,
      source: "moba-item",
      reference_image: ref,
      spell_reference_image: ref,
    };
    function runGen() {
      return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
        if (res.status === 202 || d.job_id || jobId) return pollImageJob(d.job_id || jobId);
        if (!res.ok) throw new Error(d.error || "Generate failed");
        throw new Error("No image returned");
      })
      .then(function (url) {
        if (!url) throw new Error("No image URL");
        showThumbPreview(url);
        shopStatus("Got the still — saving over id " + it.id + "…");
        return saveIdentity(it.id, url);
      })
      .then(function () {
        shopStatus("New thumbnail saved over " + it.name + " (id " + it.id + ").");
      })
      .catch(function (err) {
        shopStatus((err && err.message) || "Generate failed");
      })
      .then(function () {
        setGenerateBusy(false);
      });
    }
    var ready = it.look && it.look.prompt
      ? Promise.resolve()
      : describeSelected(true).then(function () {
          it = itemsById[selectedId] || it;
          body.stasis = itemGeneratePrompt(it, alter).slice(0, 4000);
          body.prompt = body.stasis;
          body.fused_prompt = body.stasis;
        });
    ready.then(runGen).catch(function (err) {
      shopStatus((err && err.message) || "Generate failed");
      setGenerateBusy(false);
    });
  }

  function describeSelected(quiet) {
    if (!selectedId) return Promise.reject(new Error("Pick an item"));
    if (!quiet) shopStatus("Reading icon like Transfer…");
    return fetch(apiUrl("/api/moba-items/" + encodeURIComponent(selectedId) + "/describe"), {
      method: "POST",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || d.ok === false) throw new Error((d && d.error) || "Describe failed");
        var it = itemsById[selectedId];
        if (it) it.look = d.look;
        catalogItems = catalogItems.map(function (row) {
          if (row.id === selectedId) {
            row.look = d.look;
          }
          return row;
        });
        selectItem(selectedId);
        if (!quiet) shopStatus("Look saved for " + ((it && it.name) || selectedId));
        return d.look;
      });
  }

  function describeAllLooks() {
    shopStatus("Describing all unique shop icons (Transfer-style)…");
    fetch(apiUrl("/api/moba-items/describe-missing"), { method: "POST" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        shopStatus(
          (d && d.describe && d.describe.busy ? "Describing in background…" : "Describe queued.") +
            " Open items as looks land."
        );
        var n = 0;
        function tick() {
          return loadItems().then(function () {
            n += 1;
            if (n > 80) return;
            setTimeout(tick, 4000);
          });
        }
        setTimeout(tick, 2500);
      })
      .catch(function (err) {
        shopStatus((err && err.message) || "Describe-all failed");
      });
  }

  function resetSelectedTemp() {
    if (!selectedId) return;
    fetch(apiUrl("/api/moba-items/" + encodeURIComponent(selectedId) + "/reset"), { method: "POST" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d && d.item) {
          itemsById[d.item.id] = d.item;
          catalogItems = catalogItems.map(function (row) {
            return row.id === d.item.id ? d.item : row;
          });
          selectItem(d.item.id);
          shopStatus("Restored League temp for " + d.item.id);
        } else shopStatus((d && d.error) || "Reset failed");
      })
      .catch(function (err) {
        shopStatus((err && err.message) || "Reset failed");
      });
  }

  function pullTemps() {
    shopStatus("Pulling League item icons…");
    fetch(apiUrl("/api/moba-items/sync"), { method: "POST" })
      .then(function (r) {
        return r.json();
      })
      .then(function () {
        var n = 0;
        function tick() {
          return loadItems().then(function () {
            if (catalogItems.length) {
              shopStatus(catalogItems.length + " item identities ready.");
              return;
            }
            n += 1;
            if (n > 40) {
              shopStatus("Sync still running — try Pull temps again in a minute.");
              return;
            }
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(tick());
              }, 1500);
            });
          });
        }
        return tick();
      })
      .catch(function (err) {
        shopStatus((err && err.message) || "Sync failed");
      });
  }

  var toastT = 0;
  function toast(msg) {
    var el = $("mb-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    toastT = 2.2;
  }

  function update(dt) {
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0 && $("mb-toast")) $("mb-toast").classList.remove("show");
    }
    groveTime += dt;
    if (ended) return;
    spawnT += dt;
    if (spawnT > 28) {
      spawnT = 0;
      spawnWave();
    }
    ["q", "w", "e", "r"].forEach(function (k) {
      player[k] = Math.max(0, player[k] - dt);
    });
    if (alive(player) && inFountain(player)) {
      player.hp = Math.min(player.maxHp, player.hp + 70 * dt);
      player.mana = Math.min(player.maxMana, player.mana + 50 * dt);
    }
    if (alive(player) && player.recall > 0) {
      if (Math.hypot(player.tx - player.x, player.ty - player.y) > 14) {
        cancelRecall("Recall interrupted");
      } else if (Math.hypot(player.x - player.recallX, player.y - player.recallY) > 10) {
        cancelRecall("Recall interrupted");
      } else {
        player.tx = player.x;
        player.ty = player.y;
        player.recall -= dt;
        if (player.recall <= 0) finishRecall();
      }
    } else if (alive(player)) {
      moveToward(player, player.tx, player.ty, dt);
      tryAttack(player, dt);
    }
    units.forEach(function (u) {
      if (u === player) return;
      if (u.dead > 0) {
        if (u.kind === "champ" || u.kind === "camp" || u.kind === "boss") {
          u.dead -= dt;
          if (u.dead <= 0) {
            u.hp = u.maxHp;
            u.dead = 0;
            if (u.kind === "champ") {
              u.x = u.team === "blue" ? 720 : 8880;
              u.y = u.team === "blue" ? 8880 : 720;
            }
          }
        }
        return;
      }
      if (u.kind === "inhibitor") return;
      if (u.kind === "tower") {
        var tFoe = nearest(u, enemies(u), u.range);
        if (tFoe) {
          u.atkCd -= dt;
          if (u.atkCd <= 0) {
            u.atkCd = 0.85;
            deal(u, tFoe, u.ad);
          }
        }
        return;
      }
      if (u.kind === "nexus") return;
      if ((u.kind === "camp" || u.kind === "boss") && dist(u, player) < 380) {
        u.tx = player.x;
        u.ty = player.y;
      }
      if (u.kind === "champ" && u.bot) botThink(u);
      if (u.kind === "minion") {
        var mFoe = nearest(u, enemies(u), 320);
        if (mFoe && dist(u, mFoe) < 280) {
          u.tx = mFoe.x;
          u.ty = mFoe.y;
        } else followLane(u);
      }
      if (!tryAttack(u, dt)) moveToward(u, u.tx, u.ty, dt);
    });
    if (player.dead > 0) {
      player.dead -= dt;
      if (player.dead <= 0) {
        player.hp = player.maxHp;
        player.mana = player.maxMana;
        player.x = player.tx = 720;
        player.y = player.ty = 8880;
      }
    }
    shots.forEach(function (s) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      units.forEach(function (u) {
        if (!alive(u) || u.team === s.team) return;
        if (Math.hypot(u.x - s.x, u.y - s.y) < (u.kind === "champ" ? 18 : 14) + s.r) {
          deal(player, u, s.dmg);
          s.life = 0;
        }
      });
    });
    shots = shots.filter(function (s) {
      return s.life > 0;
    });
    units = units.filter(function (u) {
      return (
        u.kind === "champ" ||
        u.kind === "tower" ||
        u.kind === "nexus" ||
        u.kind === "inhibitor" ||
        u.kind === "camp" ||
        u.kind === "boss" ||
        u.hp > 0
      );
    });
    cam.x += (player.x - cam.x) * Math.min(1, dt * 5);
    cam.y += (player.y - cam.y) * Math.min(1, dt * 5);
    hud();
  }

  function hud() {
    if ($("mb-gold")) $("mb-gold").textContent = gold + "g";
    if ($("mb-kda")) $("mb-kda").textContent = kda[0] + "/" + kda[1] + "/" + kda[2];
    if ($("mb-hp")) $("mb-hp").textContent = Math.ceil(player.hp) + " / " + player.maxHp;
    if ($("mb-mp")) $("mb-mp").textContent = Math.ceil(player.mana) + " / " + player.maxMana;
    ["q", "w", "e", "r"].forEach(function (k) {
      var el = $("mb-" + k);
      if (el) el.textContent = player[k] > 0.05 ? player[k].toFixed(1) : k.toUpperCase();
      var wrap = el && el.parentElement;
      if (wrap && window.SpellMapTextures) {
        var n = window.SpellMapTextures.getNums()[k];
        wrap.style.backgroundImage = n
          ? "url(\"" + window.SpellMapTextures.spellUrl(n) + "\")"
          : "";
      }
    });
    updateShopPlace();
    renderInv();
  }

  function drawMap(ox, oy) {
    if (window.SpellMapTextures && typeof window.SpellMapTextures.drawArena === "function") {
      window.SpellMapTextures.drawArena(ctx, ox, oy, viewW, viewH);
      return;
    }
    ctx.fillStyle = "#14281c";
    ctx.fillRect(0, 0, viewW, viewH);
    var gx;
    var gy;
    ctx.fillStyle = "#163222";
    for (gy = 0; gy < H; gy += 280) {
      for (gx = 0; gx < W; gx += 280) {
        if (((gx + gy) / 280) % 2 < 1) ctx.fillRect(gx - ox, gy - oy, 280, 280);
      }
    }
    ctx.strokeStyle = "#3d6e4a";
    ctx.lineWidth = 160;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    function strokePts(pts) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] - ox, pts[0][1] - oy);
      var i;
      for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] - ox, pts[i][1] - oy);
      ctx.stroke();
    }
    strokePts(waypoints("blue", "top"));
    strokePts(waypoints("blue", "mid"));
    strokePts(waypoints("blue", "bot"));
    ctx.fillStyle = "#2a5a78";
    ctx.beginPath();
    ctx.moveTo(0 - ox, 6200 - oy);
    ctx.lineTo(6200 - ox, 0 - oy);
    ctx.lineTo(7200 - ox, 1000 - oy);
    ctx.lineTo(1000 - ox, 7200 - oy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0f2a18";
    [
      [1800, 3600, 900, 700],
      [3600, 1800, 700, 900],
      [6200, 3600, 900, 700],
      [3600, 6200, 700, 900],
      [2200, 5200, 600, 500],
      [5200, 2200, 500, 600],
    ].forEach(function (b) {
      ctx.fillRect(b[0] - ox, b[1] - oy, b[2], b[3]);
    });
    ctx.fillStyle = "#102838";
    ctx.fillRect(80 - ox, 8000 - oy, 1500, 1520);
    ctx.fillStyle = "#401010";
    ctx.fillRect(8000 - ox, 80 - oy, 1520, 1500);
  }

  function loadGroveArt() {
    if (groveLoaded) return;
    groveLoaded = true;
    [1, 2, 3, 4].forEach(function (n) {
      var im = new Image();
      im.decoding = "async";
      im.onload = function () {
        groveImgs[n - 1] = im;
      };
      im.src = "moba-art/summon-" + n + ".jpg";
    });
    [1, 2].forEach(function (n) {
      var im = new Image();
      im.decoding = "async";
      im.onload = function () {
        gateImgs[n - 1] = im;
      };
      im.src = "moba-art/gate-" + n + ".jpg";
    });
    ["champ-sevin.jpg", "champ-rival.jpg", "champ-wing.jpg"].forEach(function (name, i) {
      var im = new Image();
      im.decoding = "async";
      im.onload = function () {
        champImgs[i] = im;
      };
      im.src = "moba-art/" + name;
    });
  }

  function drawLotus(lx, ly, s, col) {
    ctx.fillStyle = col;
    var k;
    for (k = 0; k < 5; k++) {
      var aa = k * 1.256 + groveTime * 0.15;
      ctx.beginPath();
      ctx.ellipse(
        lx + Math.cos(aa) * s * 0.42,
        ly + Math.sin(aa) * s * 0.22,
        s * 0.34,
        s * 0.16,
        aa,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,230,140,0.92)";
    ctx.beginPath();
    ctx.arc(lx, ly, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRuneTree(tx, ty, h, lean) {
    ctx.strokeStyle = "#24180f";
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + lean, ty - h * 0.52, tx + lean * 0.25, ty - h);
    ctx.stroke();
    ctx.strokeStyle = "rgba(210, 175, 90, 0.8)";
    ctx.lineWidth = 1.3;
    var r;
    for (r = 0; r < 5; r++) {
      var yy = ty - h * (0.22 + r * 0.15);
      ctx.beginPath();
      ctx.arc(tx + lean * (0.08 + r * 0.04), yy, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(90, 40, 120, 0.28)";
    ctx.beginPath();
    ctx.ellipse(tx + lean * 0.2, ty - h - 18, 46, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(200, 230, 255, 0.22)";
    ctx.beginPath();
    ctx.ellipse(tx + lean * 0.15, ty - h - 8, 28, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSummonGrove(ox, oy, cx, cy, team) {
    var x = cx - ox;
    var y = cy - oy;
    if (x < -520 || y < -520 || x > viewW + 520 || y > viewH + 520) return;
    var t = groveTime;
    var red = team === "red";
    var rx = 360;
    var ry = 245;
    var plaza = groveImgs[red ? 3 : 2] || groveImgs[0];
    var well = groveImgs[red ? 0 : 1] || groveImgs[0];
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, rx + 120, ry + 90, 0, 0, Math.PI * 2);
    ctx.clip();
    if (plaza) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(plaza, x - rx - 120, y - ry - 110, (rx + 120) * 2, (ry + 110) * 2);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = red ? "rgba(40, 8, 22, 0.35)" : "rgba(8, 16, 36, 0.4)";
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = red ? "rgba(48, 22, 28, 0.5)" : "rgba(16, 36, 32, 0.5)";
    ctx.beginPath();
    ctx.ellipse(x, y, rx + 78, ry + 58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    if (well) {
      ctx.globalAlpha = 0.95;
      ctx.drawImage(well, x - rx, y - ry, rx * 2, ry * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = red ? "rgba(90, 12, 40, 0.28)" : "rgba(12, 18, 70, 0.3)";
      ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
    } else {
      ctx.fillStyle = red ? "#3a1024" : "#101838";
      ctx.fill();
    }
    var i;
    for (i = 0; i < 7; i++) {
      var p = (t * 0.2 + i * 0.14) % 1;
      ctx.beginPath();
      ctx.ellipse(x, y, 36 + p * rx, 24 + p * ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(220, 240, 255," + (0.32 * (1 - p)).toFixed(3) + ")";
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    ctx.restore();
    for (i = 0; i < 12; i++) {
      var a = t * 0.16 + i * (Math.PI * 2 / 12);
      var gx = x + Math.cos(a) * (rx - 16);
      var gy = y + Math.sin(a) * (ry - 16);
      ctx.strokeStyle = i % 2 ? "rgba(160, 255, 230, 0.88)" : "rgba(255, 150, 210, 0.88)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(gx, gy, 6.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gx - 4, gy);
      ctx.lineTo(gx + 4, gy);
      ctx.moveTo(gx, gy - 4);
      ctx.lineTo(gx, gy + 4);
      ctx.stroke();
    }
    drawLotus(x - rx * 0.72, y + ry * 0.38, 17, "rgba(230, 140, 200, 0.88)");
    drawLotus(x + rx * 0.68, y + ry * 0.22, 15, "rgba(180, 160, 255, 0.88)");
    drawLotus(x - rx * 0.18, y + ry * 0.78, 13, "rgba(255, 200, 140, 0.85)");
    drawLotus(x + rx * 0.12, y - ry * 0.78, 14, "rgba(140, 220, 210, 0.85)");
    drawLotus(x + rx * 0.82, y - ry * 0.1, 12, "rgba(255, 180, 210, 0.8)");
    drawRuneTree(x - 250, y + 10, 170, -28);
    drawRuneTree(x + 260, y + 24, 158, 34);
    drawRuneTree(x - 30, y - 128, 200, 8);
    drawRuneTree(x - 160, y - 80, 130, -12);
    ctx.lineCap = "round";
    ctx.lineWidth = 3.2;
    var ribbons = [
      "rgba(120,255,210,0.42)",
      "rgba(255,170,220,0.42)",
      "rgba(255,220,120,0.38)",
      "rgba(150,180,255,0.42)",
    ];
    for (i = 0; i < ribbons.length; i++) {
      ctx.strokeStyle = ribbons[i];
      ctx.beginPath();
      var a0 = t * 0.65 + i * 0.9;
      ctx.moveTo(x + Math.cos(a0) * 36, y + Math.sin(a0) * 18);
      ctx.bezierCurveTo(
        x + Math.cos(a0 + 0.9) * rx * 0.72,
        y - 90 - i * 14,
        x + Math.cos(a0 + 1.7) * rx * 0.95,
        y - 36,
        x + Math.cos(a0 + 2.4) * rx * 0.48,
        y + Math.sin(a0 + 1.1) * ry * 0.42
      );
      ctx.stroke();
    }
    for (i = 0; i < 7; i++) {
      var ka = t * 0.52 + i * 0.9;
      var kx = x + Math.cos(ka) * (rx * 0.58);
      var ky = y + Math.sin(ka) * (ry * 0.48);
      ctx.save();
      ctx.translate(kx, ky);
      ctx.rotate(ka + Math.PI / 2);
      ctx.fillStyle = i % 2 ? "rgba(255,214,168,0.9)" : "rgba(150,240,228,0.9)";
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(-20, -5);
      ctx.lineTo(-20, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "rgba(255,240,180,0.85)";
    for (i = 0; i < 22; i++) {
      var sp = (t * 0.35 + i * 0.31) % 1;
      var sa = i * 2.15;
      ctx.globalAlpha = 0.2 + 0.7 * Math.abs(Math.sin(t * 1.4 + i));
      ctx.beginPath();
      ctx.arc(x + Math.cos(sa) * rx * sp, y + Math.sin(sa) * ry * sp, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(232, 200, 120, 0.58)";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawWorldDecor(ox, oy) {
    WALLS.forEach(function (w) {
      var x = w[0] - ox;
      var y = w[1] - oy;
      if (x > viewW + 40 || y > viewH + 40 || x + w[2] < -40 || y + w[3] < -40) return;
      ctx.fillStyle = "#1a140c";
      ctx.fillRect(x, y, w[2], w[3]);
      ctx.strokeStyle = "#3d4a28";
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 2, y + 2, w[2] - 4, w[3] - 4);
      ctx.fillStyle = "rgba(70, 110, 50, 0.28)";
      ctx.fillRect(x, y, w[2], 8);
    });
    drawLaneGates(ox, oy);
    drawSummonGrove(ox, oy, 830, 8760, "blue");
    drawSummonGrove(ox, oy, 8770, 830, "red");
  }

  function drawMinionCaryatid(x, y, h, team, caster) {
    var stone = team === "red" ? "#6a4a48" : team === "blue" ? "#4a5560" : "#5a564c";
    var helm = team === "red" ? "#7a3038" : "#2c4860";
    ctx.fillStyle = stone;
    ctx.fillRect(x - 11, y - h * 0.38, 9, h * 0.38);
    ctx.fillRect(x + 2, y - h * 0.38, 9, h * 0.38);
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.5, 17, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = helm;
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.74, 15, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    if (caster) {
      ctx.beginPath();
      ctx.moveTo(x - 14, y - h * 0.84);
      ctx.lineTo(x, y - h - 10);
      ctx.lineTo(x + 14, y - h * 0.84);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(140, 230, 255, 0.75)";
    ctx.fillRect(x - 8, y - h * 0.76, 16, 3.5);
    ctx.strokeStyle = "rgba(210, 175, 90, 0.65)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x - 7, y - h * 0.58, 14, 10);
  }

  function drawLaneGate(ox, oy, g) {
    var x = g.x - ox;
    var y = g.y - oy;
    if (x < -180 || y < -180 || x > viewW + 180 || y > viewH + 180) return;
    var t = groveTime;
    ctx.save();
    ctx.translate(x, y);
    if (g.facing === "ew") ctx.rotate(Math.PI / 2);
    if (g.facing === "diag") ctx.rotate(-Math.PI / 4);
    var art = gateImgs[g.team === "red" ? 1 : 0] || gateImgs[0];
    var hw = 78;
    var hh = 108;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-hw, 16);
    ctx.lineTo(-hw, -hh + 28);
    ctx.quadraticCurveTo(0, -hh - 18, hw, -hh + 28);
    ctx.lineTo(hw, 16);
    ctx.closePath();
    ctx.clip();
    if (art) {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(art, -hw - 10, -hh - 24, hw * 2 + 20, hh + 50);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = g.team === "red" ? "rgba(70, 16, 28, 0.28)" : "rgba(16, 28, 55, 0.28)";
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#5a5348";
    ctx.lineWidth = 14;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(-hw, 18);
    ctx.lineTo(-hw, -hh + 30);
    ctx.quadraticCurveTo(0, -hh - 16, hw, -hh + 30);
    ctx.lineTo(hw, 18);
    ctx.stroke();
    ctx.strokeStyle = "rgba(80, 200, 170, 0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
    var i;
    ctx.strokeStyle = "rgba(30, 28, 24, 0.55)";
    ctx.lineWidth = 3;
    for (i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 16, 10);
      ctx.lineTo(i * 16, -hh + 36);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 220, 120, 0.55)";
    for (i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(i * 16, -hh + 34, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    drawMinionCaryatid(-hw - 2, 20, hh + 8, g.team, false);
    drawMinionCaryatid(hw + 2, 20, hh + 8, g.team, true);
    ctx.strokeStyle = "#3a2e22";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-hw - 18, 8);
    ctx.quadraticCurveTo(-40, -hh * 0.4, 10, -hh + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hw + 16, 10);
    ctx.quadraticCurveTo(36, -hh * 0.35, -8, -hh + 14);
    ctx.stroke();
    ctx.fillStyle = "rgba(90, 70, 180, 0.55)";
    ctx.beginPath();
    ctx.arc(-hw - 8, -20, 5, 0, Math.PI * 2);
    ctx.arc(hw + 10, -28, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(210, 180, 90, 0.7)";
    ctx.lineWidth = 1.1;
    for (i = 0; i < 6; i++) {
      var a = t * 0.4 + i * 1.1;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 36, -hh * 0.35 + Math.sin(a * 1.3) * 12, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(140, 255, 200, 0.12)";
    ctx.beginPath();
    ctx.ellipse(0, -hh * 0.25, 48, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLaneGates(ox, oy) {
    LANE_GATES.forEach(function (g) {
      drawLaneGate(ox, oy, g);
    });
  }

  function drawLiveMinion(u, x, y, col) {
    var role = u.role || "melee";
    var bob = Math.sin(groveTime * 9 + u.x * 0.05) * (role === "cannon" ? 1.2 : 2.2);
    var ang = u.facing || 0;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(ang + Math.PI / 2);
    if (role === "cannon") {
      ctx.fillStyle = "#2a241c";
      ctx.fillRect(-11, -6, 22, 18);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, -8, 14, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a140e";
      ctx.fillRect(-4, -28, 8, 22);
      ctx.fillStyle = "rgba(232, 200, 120, 0.85)";
      ctx.beginPath();
      ctx.arc(0, -28, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.fillRect(-7, -12, 14, 5);
    } else if (role === "caster") {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-11, 10);
      ctx.lineTo(0, -22);
      ctx.lineTo(11, 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(20, 16, 28, 0.85)";
      ctx.beginPath();
      ctx.ellipse(0, -8, 8, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(180, 230, 255, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, 6);
      ctx.lineTo(10, -26);
      ctx.stroke();
      ctx.fillStyle = "rgba(160, 255, 220, 0.85)";
      ctx.beginPath();
      ctx.arc(10, -28, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#3a342c";
      ctx.fillRect(-7, 2, 5, 10);
      ctx.fillRect(2, 2, 5, 10);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, -2, 11, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = u.team === "red" ? "#6a3038" : "#243848";
      ctx.beginPath();
      ctx.ellipse(0, -14, 10, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(140, 230, 255, 0.8)";
      ctx.fillRect(-6, -16, 12, 3);
      ctx.fillStyle = "#c9a227";
      ctx.fillRect(8, -8, 11, 3);
    }
    ctx.restore();
  }

  function drawUnit(u, ox, oy) {
    if (u.dead > 0 && (u.kind === "champ" || u.kind === "camp" || u.kind === "boss")) return;
    var x = u.x - ox;
    var y = u.y - oy;
    if (x < -50 || y < -50 || x > viewW + 50 || y > viewH + 50) return;
    var col = u.team === "neutral" ? "#c9a227" : teamColor(u.team);
    ctx.fillStyle = col;
    if (u.kind === "tower") {
      ctx.fillStyle = "#2a2418";
      ctx.fillRect(x - 18, y - 8, 36, 22);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x - 16, y - 8);
      ctx.lineTo(x, y - 52);
      ctx.lineTo(x + 16, y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e8d5a3";
      ctx.beginPath();
      ctx.arc(x, y - 40, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (u.kind === "inhibitor") {
      ctx.fillStyle = "#1c1810";
      ctx.fillRect(x - 14, y - 10, 28, 24);
      ctx.fillStyle = col;
      ctx.fillRect(x - 8, y - 36, 16, 28);
      ctx.beginPath();
      ctx.arc(x, y - 40, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e8d5a3";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - 40, 14, 0, Math.PI * 2);
      ctx.stroke();
    } else if (u.kind === "nexus") {
      var i;
      ctx.fillStyle = col;
      ctx.beginPath();
      for (i = 0; i < 6; i++) {
        var a = (Math.PI / 3) * i - Math.PI / 6;
        var px = x + Math.cos(a) * 42;
        var py = y + Math.sin(a) * 42;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e8d5a3";
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
    } else if (u.kind === "minion") {
      drawLiveMinion(u, x, y, col);
    } else if (u.kind === "camp" || u.kind === "boss") {
      var r = u.kind === "boss" ? 28 : 16;
      ctx.fillStyle = u.shape === "dragon" ? "#7a3aa0" : u.shape === "baron" ? "#5a2a10" : "#6a8a3a";
      if (u.shape === "dragon") {
        ctx.beginPath();
        ctx.moveTo(x - r, y + 8);
        ctx.lineTo(x + r + 8, y);
        ctx.lineTo(x - 6, y - r);
        ctx.closePath();
        ctx.fill();
      } else if (u.shape === "baron") {
        ctx.beginPath();
        ctx.ellipse(x, y, r + 6, r - 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x + r - 4, y - 18, 8, 22);
      } else {
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2a2010";
        ctx.beginPath();
        ctx.arc(x - 6, y - 4, 3, 0, Math.PI * 2);
        ctx.arc(x + 6, y - 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (u.kind === "champ") {
      drawStormMage(u, x, y);
    } else {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    if (u.maxHp) {
      var barY = u.kind === "champ" ? y - 172 : y - 36;
      var barW = u.kind === "champ" ? 44 : 36;
      ctx.fillStyle = "#222";
      ctx.fillRect(x - barW / 2, barY, barW, 5);
      ctx.fillStyle = u.team === "neutral" ? "#c9a227" : u.team === "blue" ? "#3dba6a" : "#e24b4b";
      ctx.fillRect(x - barW / 2, barY, barW * (u.hp / u.maxHp), 5);
    }
  }

  function drawStormMage(u, x, y) {
    var bob = Math.sin(groveTime * 2.6) * 4;
    var img = u.team === "red" ? champImgs[1] || champImgs[2] : champImgs[0] || champImgs[2];
    var h = u === player ? 168 : 148;
    var w = h * 0.58;
    var i;
    var flip = Math.cos(u.facing || 0) < 0;
    ctx.save();
    ctx.translate(x, y);
    for (i = 6; i >= 1; i--) {
      var p = (groveTime * 0.5 + i * 0.16) % 1;
      ctx.beginPath();
      ctx.ellipse(0, 10, 14 + i * 8 * p, 6 + i * 3.2 * p, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(80, 245, 230," + (0.32 * (1 - p)).toFixed(3) + ")";
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(30, 160, 190, 0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 12, 28, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    if (flip) ctx.scale(-1, 1);
    ctx.translate(0, bob);
    ctx.fillStyle = "#0e2a38";
    ctx.beginPath();
    ctx.moveTo(-18, 8);
    ctx.quadraticCurveTo(0, 18, 18, 8);
    ctx.quadraticCurveTo(22, -20, 8, -48);
    ctx.lineTo(-8, -48);
    ctx.quadraticCurveTo(-22, -20, -18, 8);
    ctx.fill();
    ctx.fillStyle = "#c8f7f2";
    ctx.beginPath();
    ctx.moveTo(-22, -52);
    ctx.quadraticCurveTo(-40, -20, -28, 6);
    ctx.quadraticCurveTo(-8, -30, 4, -58);
    ctx.quadraticCurveTo(-6, -70, -22, -52);
    ctx.fill();
    ctx.fillStyle = "#f2e6d4";
    ctx.beginPath();
    ctx.ellipse(0, -62, 11, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d4f6ff";
    ctx.fillRect(-9, -68, 18, 3);
    ctx.fillStyle = "#e8f4ff";
    ctx.fillRect(-14, -50, 28, 22);
    ctx.fillStyle = "#c9a227";
    ctx.fillRect(-14, -50, 28, 3);
    ctx.fillStyle = "#5ee6dc";
    ctx.beginPath();
    ctx.arc(0, -38, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(16, -8);
    ctx.lineTo(22, -88);
    ctx.stroke();
    ctx.fillStyle = "#7ff6ee";
    ctx.shadowColor = "#7ff6ee";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(22, -92, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (img && img.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      roundMageClip(0, -h * 0.42, w * 0.92, h * 0.92);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, -w / 2, -h + 14, w, h);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = u === player ? "rgba(170, 255, 245, 0.9)" : "rgba(255, 170, 170, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 12, 18, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(232, 213, 163, 0.95)";
    ctx.font = "bold 12px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(u === player ? "Sevin" : u.name || "Rival", 0, -h + 2 + bob);
    if (u === player && player.recall > 0) {
      var max = player.recallMax || 8;
      var pct = 1 - player.recall / max;
      var i;
      ctx.strokeStyle = "rgba(90, 240, 230, 0.55)";
      ctx.lineWidth = 2;
      for (i = 0; i < 8; i++) {
        var a = groveTime * 1.6 + i * 0.785;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 28, 4 + Math.sin(a) * 10, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(8, 18, 28, 0.8)";
      ctx.fillRect(-36, 22, 72, 9);
      ctx.fillStyle = "#5ef0e8";
      ctx.fillRect(-36, 22, 72 * pct, 9);
      ctx.strokeStyle = "rgba(232, 213, 163, 0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(-36, 22, 72, 9);
      ctx.fillStyle = "#e8d5a3";
      ctx.font = "10px Bahnschrift, sans-serif";
      ctx.fillText("Recall " + player.recall.toFixed(1) + "s", 0, 42);
    }
    ctx.restore();
  }

  function roundMageClip(cx, cy, w, h) {
    var x = cx - w / 2;
    var y = cy - h / 2;
    var r = Math.min(22, w * 0.22);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    if (!ctx) return;
    var ox = cam.x - viewW / 2;
    var oy = cam.y - viewH / 2;
    drawMap(ox, oy);
    drawWorldDecor(ox, oy);
    units.forEach(function (u) {
      drawUnit(u, ox, oy);
    });
    shots.forEach(function (s) {
      var sx = s.x - ox;
      var sy = s.y - oy;
      ctx.fillStyle = s.col;
      ctx.shadowColor = s.col;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.strokeStyle = "rgba(200,220,255,0.35)";
    ctx.beginPath();
    ctx.arc(player.tx - ox, player.ty - oy, 8, 0, Math.PI * 2);
    ctx.stroke();
    var mm = 196;
    var mx = 12;
    var my = viewH - mm - 12;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(mx, my, mm, mm);
    ctx.fillStyle = "#1a3a28";
    ctx.fillRect(mx + 4, my + 4, mm - 8, mm - 8);
    units.forEach(function (u) {
      if (u.dead > 0 && u.kind === "champ") return;
      ctx.fillStyle = u.team === "neutral" ? "#c9a227" : teamColor(u.team);
      var px = mx + (u.x / W) * mm;
      var py = my + (u.y / H) * mm;
      var sz = u.kind === "champ" ? 5 : u.kind === "boss" ? 6 : 3;
      ctx.fillRect(px - 2, py - 2, sz, sz);
    });
    if (ended) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.fillStyle = "#e8d5a3";
      ctx.font = "42px Georgia, serif";
      ctx.fillText(ended, viewW / 2 - 90, viewH / 2);
    }
  }

  function loop(ts) {
    if (!running) return;
    var dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016);
    lastT = ts;
    update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    canvas = $("mb-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    var wrap = $("mb-stage");
    var r = wrap ? wrap.getBoundingClientRect() : { width: 900, height: 600 };
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    viewW = Math.max(320, r.width);
    viewH = Math.max(240, r.height);
    canvas.width = viewW * dpr;
    canvas.height = viewH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function toWorld(e) {
    var r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.worldX = cam.x - viewW / 2 + mouse.x;
    mouse.worldY = cam.y - viewH / 2 + mouse.y;
  }

  function start() {
    canvas = $("mb-canvas");
    if (!canvas) return;
    loadGroveArt();
    if (!player) reset();
    resize();
    if (!running) {
      running = true;
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function bind() {
    if (document.body.dataset.mbBound) return;
    document.body.dataset.mbBound = "1";
    window.addEventListener("keydown", function (e) {
      if (document.body.getAttribute("data-active-tab") !== "moba") return;
      var k = e.key.toLowerCase();
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (k === "enter" && selectedId) {
          buy(selectedId);
          e.preventDefault();
        }
        return;
      }
      keys[k] = true;
      if (k === "q" || k === "w" || k === "e" || k === "r") {
        if (!e.repeat) {
          cast(k);
          if (window.SpellMapTextures && typeof window.SpellMapTextures.randomize === "function") {
            window.SpellMapTextures.randomize(k);
            var n = window.SpellMapTextures.getNums()[k];
            toast(k.toUpperCase() + " map ← spell #" + n);
          }
        }
        e.preventDefault();
      }
      if (k === "p") {
        setShopOpen(!shopOpen);
        e.preventDefault();
      }
      if (k === "s") {
        player.tx = player.x;
        player.ty = player.y;
        e.preventDefault();
      }
      if (k === "b") {
        if (!e.repeat) startRecall();
        e.preventDefault();
      }
      if (k === "escape" && shopOpen) {
        setShopOpen(false);
        e.preventDefault();
      }
      if (k === "enter" && selectedId) buy(selectedId);
    });
    window.addEventListener("keyup", function (e) {
      keys[e.key.toLowerCase()] = false;
    });
    window.addEventListener("resize", function () {
      if (running) resize();
    });
    window.addEventListener("moba-show", start);
    window.addEventListener("moba-hide", stop);
    document.addEventListener("contextmenu", function (e) {
      if (document.body.getAttribute("data-active-tab") === "moba") e.preventDefault();
    });
  }

  function bindCanvas() {
    canvas = $("mb-canvas");
    if (!canvas || canvas.dataset.bound) return;
    canvas.dataset.bound = "1";
    canvas.addEventListener("pointerdown", function (e) {
      toWorld(e);
      if (e.button === 2 || e.shiftKey) {
        var foe = nearest({ x: mouse.worldX, y: mouse.worldY }, enemies(player), 80);
        if (foe) {
          player.tx = foe.x;
          player.ty = foe.y;
        }
      } else {
        player.tx = mouse.worldX;
        player.ty = mouse.worldY;
      }
    });
    canvas.addEventListener("pointermove", toWorld);
    $("mb-reset") && $("mb-reset").addEventListener("click", reset);
    $("mb-shop-toggle") &&
      $("mb-shop-toggle").addEventListener("click", function () {
        setShopOpen(!shopOpen);
      });
    $("mb-shop-close") &&
      $("mb-shop-close").addEventListener("click", function () {
        setShopOpen(false);
      });
    $("mb-shop-buy") && $("mb-shop-buy").addEventListener("click", function () { buy(selectedId); });
    $("mb-shop-regen") && $("mb-shop-regen").addEventListener("click", regenerateSelected);
    $("mb-shop-describe") &&
      $("mb-shop-describe").addEventListener("click", function () {
        describeSelected(false).catch(function (err) {
          shopStatus((err && err.message) || "Describe failed");
        });
      });
    $("mb-shop-describe-all") && $("mb-shop-describe-all").addEventListener("click", describeAllLooks);
    [0, 1, 2, 3, 4, 5].forEach(function (i) {
      var slot = $("mb-inv-" + i);
      if (!slot) return;
      slot.addEventListener("click", function () {
        var id = player && player.inv ? player.inv[i] : null;
        if (id) {
          selectedId = id;
          if (!shopOpen) setShopOpen(true);
          selectItem(id);
        }
      });
      slot.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        sellSlot(i);
      });
    });
    $("mb-shop-reset") && $("mb-shop-reset").addEventListener("click", resetSelectedTemp);
    $("mb-shop-sync") && $("mb-shop-sync").addEventListener("click", pullTemps);
    $("mb-shop-search") &&
      $("mb-shop-search").addEventListener("input", function () {
        shopQuery = $("mb-shop-search").value || "";
        renderShop();
      });
  }

  function init() {
    if (!$("panel-moba")) return;
    bind();
    bindCanvas();
    loadGroveArt();
    loadItems();
    if (location.hash.replace("#", "") === "moba") start();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.Moba = {
    onShow: function () {
      bindCanvas();
      start();
    },
    onHide: stop,
  };
})();
