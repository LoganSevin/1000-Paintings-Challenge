/**
 * Match — match-3/4/5 with Candy Crush-style specials + cascading falls.
 * Gems = 1:1 random spell/painting images (unique per color). Unlimited lives.
 */
(function () {
  "use strict";

  var COLS = 8;
  var ROWS = 8;
  var COLOR_COUNT = 6;
  var CELL = 54;
  var PAD = 10;
  var FALL_MS = 340;
  var POP_MS = 120;

  var TYPE = {
    NORMAL: 0,
    STRIPE_H: 1,
    STRIPE_V: 2,
    BOMB: 3,
    COLOR: 4,
  };

  var canvas, ctx;
  /** @type {Array<Array<{color:number,type:number,vy?:number}|null>>} */
  var board = [];
  var selected = null;
  var busy = false;
  var score = 0;
  var cascadeLevel = 0;
  /** Preferred cell for the single power-up from the last swap (where the match was scored). */
  var scoreFocus = null; // { r, c }
  /**
   * Per-color stylized gem skins (canvas) — spell-inspired palettes & silhouettes,
   * NOT photo crops of the original paintings.
   */
  var gemSkins = [null, null, null, null, null, null];
  var gemMeta = []; // serializable skin params
  var skinsVersion = 0;
  var SKIN_SIZE = 128;
  var STORAGE_PLAYER = "gallery.match.player.v1";
  var playerId = "";
  var playerName = "Player";
  var netTimer = 0;
  var lastSkinsVersionSeen = 0;
  var suppressSkinUpload = false;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, kind) {
    var el = $("mt-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "mt-status" + (kind === "ok" ? " ok" : kind === "err" ? " err" : "");
  }

  function updateHud() {
    var s = $("mt-score");
    var l = $("mt-lives");
    if (s) s.textContent = String(score);
    if (l) l.textContent = "∞";
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function loadPlayerIdentity() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_PLAYER) || "null");
      if (raw && raw.id) {
        playerId = String(raw.id);
        playerName = String(raw.name || "Player").slice(0, 40);
      }
    } catch (e) {}
    if (!playerId) {
      playerId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : "p-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    }
    if (!playerName || playerName === "Player") {
      playerName = "Player-" + playerId.slice(0, 4);
    }
    savePlayerIdentity();
    var input = $("mt-player-name");
    if (input) input.value = playerName;
  }

  function savePlayerIdentity() {
    try {
      localStorage.setItem(
        STORAGE_PLAYER,
        JSON.stringify({ id: playerId, name: playerName })
      );
    } catch (e) {}
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function randColor() {
    return Math.floor(Math.random() * COLOR_COUNT);
  }

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function adjacent(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  function makeTile(color, type) {
    return { color: color, type: type == null ? TYPE.NORMAL : type, vy: 0 };
  }

  function emptyBoard() {
    board = [];
    for (var r = 0; r < ROWS; r++) {
      board[r] = [];
      for (var c = 0; c < COLS; c++) board[r][c] = null;
    }
  }

  function wouldMakeMatchAt(r, c, color) {
    if (
      c >= 2 &&
      board[r][c - 1] &&
      board[r][c - 2] &&
      board[r][c - 1].color === color &&
      board[r][c - 2].color === color
    )
      return true;
    if (
      r >= 2 &&
      board[r - 1][c] &&
      board[r - 2][c] &&
      board[r - 1][c].color === color &&
      board[r - 2][c].color === color
    )
      return true;
    return false;
  }

  function fillStable() {
    emptyBoard();
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var col;
        var guard = 0;
        do {
          col = randColor();
          guard++;
        } while (guard < 40 && wouldMakeMatchAt(r, c, col));
        board[r][c] = makeTile(col, TYPE.NORMAL);
      }
    }
  }

  // ——— Stylized spell-aesthetic gem skins (not photo crops) ———

  function paintingPool() {
    var pool = [];
    var man = window.galleryManifest || [];
    if (man.length) {
      man.forEach(function (row) {
        if (row && row.number) pool.push(row.number);
      });
    }
    if (!pool.length) {
      for (var i = 1; i <= 48; i++) pool.push(i);
    }
    return pool;
  }

  function hsl(h, s, l, a) {
    if (a == null) return "hsl(" + h + "," + s + "%," + l + "%)";
    return "hsla(" + h + "," + s + "%," + l + "%," + a + ")";
  }

  function hashStr(s) {
    var h = 2166136261;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Pull mood/style colors from a spell analysis — never the photo itself. */
  function paletteFromSpell(num) {
    var a =
      window.getGalleryAnalysis && num
        ? window.getGalleryAnalysis(num)
        : null;
    var hues = [];
    if (a && a.colors && a.colors.length) {
      a.colors.forEach(function (c) {
        var m = String(c).match(/hsl\(\s*([\d.]+)/i);
        if (m) hues.push(parseFloat(m[1]));
        else {
          // named / hex-ish → hash to hue
          hues.push(hashStr(c) % 360);
        }
      });
    }
    var seed = hashStr((a && a.title) || "") ^ hashStr((a && a.mood) || "") ^ (num * 9973);
    if (!hues.length) {
      hues = [(seed % 360), (seed * 3 + 40) % 360, (seed * 7 + 90) % 360];
    }
    // Force distinct family per gem index later; keep spell character
    var mood = String((a && a.mood) || "").toLowerCase();
    var style = String((a && a.style) || "").toLowerCase();
    var sat = /vivid|bright|neon|electric/.test(mood + style) ? 82 : /dark|moody|noir|somber/.test(mood + style) ? 58 : 72;
    var lit = /pastel|soft|dream|light/.test(mood + style) ? 62 : /dark|deep|shadow/.test(mood + style) ? 42 : 52;
    return {
      hues: hues,
      sat: sat,
      lit: lit,
      title: (a && a.title) || "Spell gem " + num,
      seed: seed,
    };
  }

  function pathSilhouette(g, kind, cx, cy, r) {
    g.beginPath();
    if (kind === 0) {
      // circle cabochon
      g.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (kind === 1) {
      // hex crystal
      for (var i = 0; i < 6; i++) {
        var a = (Math.PI / 3) * i - Math.PI / 6;
        var x = cx + Math.cos(a) * r;
        var y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    } else if (kind === 2) {
      // diamond
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r * 0.85, cy);
      g.lineTo(cx, cy + r);
      g.lineTo(cx - r * 0.85, cy);
      g.closePath();
    } else if (kind === 3) {
      // rounded square crystal
      var s = r * 0.92;
      var rad = r * 0.28;
      g.moveTo(cx - s + rad, cy - s);
      g.arcTo(cx + s, cy - s, cx + s, cy + s, rad);
      g.arcTo(cx + s, cy + s, cx - s, cy + s, rad);
      g.arcTo(cx - s, cy + s, cx - s, cy - s, rad);
      g.arcTo(cx - s, cy - s, cx + s, cy - s, rad);
      g.closePath();
    } else if (kind === 4) {
      // teardrop
      g.moveTo(cx, cy - r);
      g.bezierCurveTo(cx + r, cy - r * 0.2, cx + r * 0.85, cy + r * 0.6, cx, cy + r);
      g.bezierCurveTo(cx - r * 0.85, cy + r * 0.6, cx - r, cy - r * 0.2, cx, cy - r);
      g.closePath();
    } else {
      // 8-point star cut
      for (var i = 0; i < 16; i++) {
        var rad = i % 2 === 0 ? r : r * 0.52;
        var a = (Math.PI / 8) * i - Math.PI / 2;
        var x = cx + Math.cos(a) * rad;
        var y = cy + Math.sin(a) * rad;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    }
  }

  /**
   * Fresh stylized gem: silhouette homage + spell palette texture.
   * Does NOT stamp the source painting into the cell.
   */
  function renderStylizedGem(colorIndex, pal, silhouette) {
    var c = document.createElement("canvas");
    c.width = SKIN_SIZE;
    c.height = SKIN_SIZE;
    var g = c.getContext("2d");
    var cx = SKIN_SIZE / 2;
    var cy = SKIN_SIZE / 2;
    var R = SKIN_SIZE * 0.4;
    var h0 = pal.hues[0] % 360;
    var h1 = (pal.hues[1] != null ? pal.hues[1] : h0 + 28) % 360;
    var h2 = (pal.hues[2] != null ? pal.hues[2] : h0 + 55) % 360;
    var sat = pal.sat;
    var lit = pal.lit;
    var seed = pal.seed ^ (colorIndex * 1315423911);

    // soft plate
    g.clearRect(0, 0, SKIN_SIZE, SKIN_SIZE);
    pathSilhouette(g, silhouette, cx, cy, R + 4);
    g.fillStyle = hsl(h0, sat * 0.4, 18, 0.35);
    g.fill();

    // body gradient (spell aesthetic glass/crystal)
    pathSilhouette(g, silhouette, cx, cy, R);
    var body = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    body.addColorStop(0, hsl(h0, sat, Math.min(78, lit + 22)));
    body.addColorStop(0.45, hsl(h1, sat, lit));
    body.addColorStop(1, hsl(h2, Math.min(90, sat + 8), Math.max(22, lit - 18)));
    g.fillStyle = body;
    g.fill();

    // facet planes
    g.save();
    pathSilhouette(g, silhouette, cx, cy, R);
    g.clip();
    g.globalAlpha = 0.28;
    for (var f = 0; f < 7; f++) {
      var ang = ((seed + f * 47) % 360) * (Math.PI / 180);
      g.strokeStyle = hsl((h0 + f * 17) % 360, 40, 88, 0.9);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * R * 0.1, cy + Math.sin(ang) * R * 0.1);
      g.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      g.stroke();
    }
    // micro noise sparkle (spell grit)
    g.globalAlpha = 0.35;
    for (var n = 0; n < 90; n++) {
      var nx = (seed * (n + 3) * 1103515245 + 12345) >>> 0;
      var px = (nx % SKIN_SIZE);
      var py = ((nx * 7) % SKIN_SIZE);
      // only inside roughly center
      if ((px - cx) * (px - cx) + (py - cy) * (py - cy) > R * R) continue;
      g.fillStyle = n % 3 === 0 ? "rgba(255,255,255,0.55)" : hsl((h0 + n * 9) % 360, 70, 70, 0.4);
      g.fillRect(px, py, 1.2, 1.2);
    }
    g.restore();

    // specular highlight
    g.save();
    pathSilhouette(g, silhouette, cx, cy, R);
    g.clip();
    var spec = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, 2, cx, cy, R);
    spec.addColorStop(0, "rgba(255,255,255,0.75)");
    spec.addColorStop(0.25, "rgba(255,255,255,0.2)");
    spec.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = spec;
    g.fillRect(0, 0, SKIN_SIZE, SKIN_SIZE);
    g.restore();

    // rim
    pathSilhouette(g, silhouette, cx, cy, R);
    g.strokeStyle = hsl(h0, 50, 88, 0.85);
    g.lineWidth = 3;
    g.stroke();
    pathSilhouette(g, silhouette, cx, cy, R * 0.72);
    g.strokeStyle = hsl(h1, 40, 70, 0.25);
    g.lineWidth = 1.5;
    g.stroke();

    return c;
  }

  function buildGemMetaFromPicks(picks, baseHue, sils) {
    var meta = [];
    for (var ci = 0; ci < COLOR_COUNT; ci++) {
      var pal = paletteFromSpell(picks[ci]);
      var locked = (baseHue + ci * (360 / COLOR_COUNT)) % 360;
      var hues = [locked, (locked + 22 + (pal.seed % 18)) % 360, (locked + 48) % 360];
      meta[ci] = {
        title: pal.title,
        num: picks[ci],
        silhouette: sils[ci % sils.length],
        hue: locked,
        hues: hues,
        sat: pal.sat,
        lit: pal.lit,
        seed: pal.seed,
      };
    }
    return meta;
  }

  function applyGemMeta(metaList, version) {
    if (!metaList || !metaList.length) return;
    gemMeta = metaList.slice(0, COLOR_COUNT);
    gemSkins = [];
    for (var ci = 0; ci < COLOR_COUNT; ci++) {
      var m = gemMeta[ci] || {};
      var pal = {
        hues: m.hues && m.hues.length ? m.hues : [m.hue || ci * 60],
        sat: m.sat != null ? m.sat : 72,
        lit: m.lit != null ? m.lit : 52,
        seed: m.seed || 0,
        title: m.title || "",
      };
      gemSkins[ci] = renderStylizedGem(ci, pal, m.silhouette != null ? m.silhouette : ci);
    }
    if (version != null) {
      skinsVersion = version;
      lastSkinsVersionSeen = version;
    }
    draw();
  }

  /**
   * Build 6 unique stylized gems from random spells' palettes (not the photos).
   * Broadcasts template to all devices on the gallery server.
   */
  function generateShapes(opts) {
    opts = opts || {};
    setStatus("Forging stylized spell gems…", "");
    var pool = paintingPool().slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    var picks = [];
    var seen = {};
    for (var i = 0; i < pool.length && picks.length < COLOR_COUNT; i++) {
      if (seen[pool[i]]) continue;
      seen[pool[i]] = true;
      picks.push(pool[i]);
    }
    while (picks.length < COLOR_COUNT) picks.push(1 + picks.length);

    var baseHue = Math.floor(Math.random() * 360);
    var sils = [0, 1, 2, 3, 4, 5];
    for (var i = sils.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = sils[i];
      sils[i] = sils[j];
      sils[j] = tmp;
    }

    var meta = buildGemMetaFromPicks(picks, baseHue, sils);
    var ver = Date.now();
    applyGemMeta(meta, ver);
    setStatus("Six unique stylized gems forged — syncing to network…", "ok");
    if (!opts.skipUpload && !suppressSkinUpload) {
      return uploadSkins(meta, ver, true).then(function () {
        setStatus("Gems updated on this device and shared to the network.", "ok");
      });
    }
    return Promise.resolve();
  }

  function uploadSkins(meta, ver, force) {
    return fetch(apiUrl("/api/match/live"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "skins",
        force: !!force,
        skins: { version: ver || skinsVersion || Date.now(), gems: meta || gemMeta },
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d && d.skins && d.skins.version) {
          skinsVersion = d.skins.version;
          lastSkinsVersionSeen = skinsVersion;
        }
        return d;
      })
      .catch(function () {
        return null;
      });
  }

  function localPlayerRow() {
    return {
      id: playerId,
      name: playerName,
      score: score,
      online: true,
      playing: true,
      bestScore: score,
    };
  }

  function mergePlayersWithSelf(players) {
    var list = Array.isArray(players) ? players.slice() : [];
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === playerId) {
        list[i] = Object.assign({}, list[i], {
          name: playerName,
          score: Math.max(intScore(list[i].score), score),
          online: true,
          playing: document.body.getAttribute("data-active-tab") === "match",
        });
        found = true;
        break;
      }
    }
    if (!found) list.push(localPlayerRow());
    list.sort(function (a, b) {
      return intScore(b.score) - intScore(a.score) || String(a.name || "").localeCompare(String(b.name || ""));
    });
    return list;
  }

  function intScore(v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }

  function postPresence() {
    // Always show local leaderboard row even before the network answers
    renderNetworkBoard(mergePlayersWithSelf([]), { pending: true });
    return fetch(apiUrl("/api/match/live"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "presence",
        id: playerId,
        name: playerName,
        score: score,
        playing: document.body.getAttribute("data-active-tab") === "match",
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        if (!res.ok || d.ok === false) {
          renderNetworkBoard(mergePlayersWithSelf([]), {
            error:
              res.status === 404
                ? "Match API missing — restart start_server.bat (need /api/match/live)."
                : (d && d.error) || "Could not reach match server (" + res.status + ").",
          });
          return d;
        }
        if (d.skins && d.skins.version && d.skins.version > lastSkinsVersionSeen && d.skins.gems) {
          suppressSkinUpload = true;
          applyGemMeta(d.skins.gems, d.skins.version);
          suppressSkinUpload = false;
          setStatus("Gem templates updated from the network.", "ok");
        }
        renderNetworkBoard(mergePlayersWithSelf(d.players || []), { live: true });
        return d;
      })
      .catch(function (err) {
        renderNetworkBoard(mergePlayersWithSelf([]), {
          error:
            "Offline — start start_server.bat and open the same gallery URL on each PC. " +
            ((err && err.message) || ""),
        });
        return null;
      });
  }

  function pollNetwork() {
    return fetch(apiUrl("/api/match/live") + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        if (!res.ok || d.ok === false) {
          renderNetworkBoard(mergePlayersWithSelf([]), {
            error:
              res.status === 404
                ? "Match API missing — restart start_server.bat."
                : (d && d.error) || "Scoreboard error (" + res.status + ").",
          });
          return;
        }
        if (d.skins && d.skins.version > lastSkinsVersionSeen && d.skins.gems && d.skins.gems.length) {
          suppressSkinUpload = true;
          applyGemMeta(d.skins.gems, d.skins.version);
          suppressSkinUpload = false;
        } else if (d.skins && d.skins.version) {
          lastSkinsVersionSeen = Math.max(lastSkinsVersionSeen, d.skins.version);
        }
        renderNetworkBoard(mergePlayersWithSelf(d.players || []), { live: true });
      })
      .catch(function () {
        renderNetworkBoard(mergePlayersWithSelf([]), {
          error: "Cannot reach /api/match/live — is start_server.bat running?",
        });
      });
  }

  function renderNetworkBoard(players, opts) {
    opts = opts || {};
    var el = $("mt-network-list");
    var banner = $("mt-network-banner");
    if (!el) return;
    var list = mergePlayersWithSelf(players || []);
    if (banner) {
      if (opts.error) {
        banner.textContent = opts.error;
        banner.className = "mt-net-banner err";
        banner.hidden = false;
      } else if (opts.live) {
        banner.textContent = "Live on network · " + list.length + " player" + (list.length === 1 ? "" : "s");
        banner.className = "mt-net-banner ok";
        banner.hidden = false;
      } else if (opts.pending) {
        banner.textContent = "Syncing scores…";
        banner.className = "mt-net-banner";
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    }
    el.innerHTML = list
      .map(function (p, rank) {
        var you = p.id === playerId;
        var online = p.online !== false && (you || p.online);
        return (
          '<li class="' +
          (you ? "mt-net-you" : "") +
          (online ? " mt-net-on" : " mt-net-off") +
          '">' +
          '<span class="mt-net-rank">#' +
          (rank + 1) +
          "</span>" +
          '<span class="mt-net-dot" title="' +
          (online ? "online" : "away") +
          '" aria-hidden="true"></span>' +
          '<span class="mt-net-name">' +
          escapeHtml(p.name || "Player") +
          (you ? " (you)" : "") +
          "</span>" +
          '<span class="mt-net-score">' +
          intScore(p.score) +
          "</span>" +
          "</li>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function startNetworkLoop() {
    if (netTimer) clearInterval(netTimer);
    postPresence();
    pollNetwork();
    netTimer = setInterval(function () {
      if (document.body.getAttribute("data-active-tab") === "match") {
        postPresence();
      } else {
        // still heartbeat occasionally so others see "away"
        postPresence();
      }
    }, 2500);
  }

  // ——— Matches ———

  /**
   * One power-up per matched run/cluster, placed where the match was scored
   * (swap focus) or the center of the run — never one special per gem in the line.
   */
  function findMatches() {
    var mark = {};
    var cellH = {}; // key -> { len, color, cells }
    var cellV = {};
    var hRuns = [];
    var vRuns = [];

    function key(r, c) {
      return r + "," + c;
    }

    for (var r = 0; r < ROWS; r++) {
      var c = 0;
      while (c < COLS) {
        var t = board[r][c];
        if (!t || t.type === TYPE.COLOR) {
          c++;
          continue;
        }
        var col = t.color;
        var c2 = c + 1;
        while (
          c2 < COLS &&
          board[r][c2] &&
          board[r][c2].type !== TYPE.COLOR &&
          board[r][c2].color === col
        )
          c2++;
        var len = c2 - c;
        if (len >= 3) {
          var cells = [];
          for (var x = c; x < c2; x++) {
            cells.push({ r: r, c: x });
            mark[key(r, x)] = true;
            cellH[key(r, x)] = { len: len, color: col };
          }
          hRuns.push({ cells: cells, len: len, color: col, axis: "h" });
        }
        c = c2;
      }
    }
    for (var c = 0; c < COLS; c++) {
      var r = 0;
      while (r < ROWS) {
        var t = board[r][c];
        if (!t || t.type === TYPE.COLOR) {
          r++;
          continue;
        }
        var col = t.color;
        var r2 = r + 1;
        while (
          r2 < ROWS &&
          board[r2][c] &&
          board[r2][c].type !== TYPE.COLOR &&
          board[r2][c].color === col
        )
          r2++;
        var len = r2 - r;
        if (len >= 3) {
          var cells = [];
          for (var y = r; y < r2; y++) {
            cells.push({ r: y, c: c });
            mark[key(y, c)] = true;
            cellV[key(y, c)] = { len: len, color: col };
          }
          vRuns.push({ cells: cells, len: len, color: col, axis: "v" });
        }
        r = r2;
      }
    }

    function pickSpot(cells) {
      if (scoreFocus) {
        for (var i = 0; i < cells.length; i++) {
          if (cells[i].r === scoreFocus.r && cells[i].c === scoreFocus.c) return cells[i];
        }
      }
      return cells[Math.floor(cells.length / 2)];
    }

    var specials = [];
    var claimed = {}; // cell key already has a special this resolve
    var runClaimed = {}; // run id already spawned a special

    function addSpecial(spot, type, color, runId) {
      if (!spot) return;
      var k = spot.r + "," + spot.c;
      if (claimed[k]) return;
      if (runId && runClaimed[runId]) return;
      claimed[k] = true;
      if (runId) runClaimed[runId] = true;
      specials.push({ r: spot.r, c: spot.c, type: type, color: color });
    }

    // Match-5+: exactly one color popper per run of 5+
    hRuns.forEach(function (run, idx) {
      if (run.len < 5) return;
      addSpecial(pickSpot(run.cells), TYPE.COLOR, run.color, "h5-" + idx);
    });
    vRuns.forEach(function (run, idx) {
      if (run.len < 5) return;
      addSpecial(pickSpot(run.cells), TYPE.COLOR, run.color, "v5-" + idx);
    });

    // T / L: one bomb per intersection cluster (cell in both H and V of 3+)
    var bombSpots = [];
    Object.keys(mark).forEach(function (k) {
      if (!cellH[k] || !cellV[k]) return;
      if (cellH[k].len < 3 || cellV[k].len < 3) return;
      // skip if this cell is only part of a pure 5 already claimed as color
      var p = k.split(",");
      bombSpots.push({
        r: parseInt(p[0], 10),
        c: parseInt(p[1], 10),
        color: cellH[k].color,
      });
    });
    if (bombSpots.length) {
      var bombSpot = pickSpot(bombSpots);
      // one bomb for the whole T/L cluster
      addSpecial(bombSpot, TYPE.BOMB, bombSpot.color, "tl-cluster");
    }

    // Match-4: exactly one stripe per run of exactly 4 (not 5+)
    hRuns.forEach(function (run, idx) {
      if (run.len !== 4) return;
      addSpecial(pickSpot(run.cells), TYPE.STRIPE_H, run.color, "h4-" + idx);
    });
    vRuns.forEach(function (run, idx) {
      if (run.len !== 4) return;
      addSpecial(pickSpot(run.cells), TYPE.STRIPE_V, run.color, "v4-" + idx);
    });

    return { clear: Object.keys(mark), specials: specials, mark: mark };
  }

  function activateTile(r, c, triggerColor, detonated) {
    if (!inBounds(r, c) || !board[r][c]) return;
    var k = r + "," + c;
    if (detonated[k]) return;
    detonated[k] = true;
    var t = board[r][c];
    var toClear = [k];

    if (t.type === TYPE.STRIPE_H) {
      for (var x = 0; x < COLS; x++) toClear.push(r + "," + x);
    } else if (t.type === TYPE.STRIPE_V) {
      for (var y = 0; y < ROWS; y++) toClear.push(y + "," + c);
    } else if (t.type === TYPE.BOMB) {
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (inBounds(r + dr, c + dc)) toClear.push(r + dr + "," + (c + dc));
        }
      }
    } else if (t.type === TYPE.COLOR) {
      var target = triggerColor != null ? triggerColor : randColor();
      for (var y = 0; y < ROWS; y++) {
        for (var x = 0; x < COLS; x++) {
          if (board[y][x] && board[y][x].type !== TYPE.COLOR && board[y][x].color === target) {
            toClear.push(y + "," + x);
          }
        }
      }
    }

    toClear.forEach(function (ck) {
      if (detonated[ck]) return;
      detonated[ck] = true;
      var p = ck.split(",");
      var rr = parseInt(p[0], 10);
      var cc = parseInt(p[1], 10);
      if (!inBounds(rr, cc) || !board[rr][cc]) return;
      var tt = board[rr][cc];
      if (tt.type !== TYPE.NORMAL && !(rr === r && cc === c)) {
        activateTile(rr, cc, t.type === TYPE.COLOR ? triggerColor : t.color, detonated);
      }
    });
  }

  function clearKeys(keys) {
    var n = 0;
    keys.forEach(function (k) {
      var p = k.split(",");
      var r = parseInt(p[0], 10);
      var c = parseInt(p[1], 10);
      if (inBounds(r, c) && board[r][c]) {
        board[r][c] = null;
        n++;
      }
    });
    score += n * (10 + cascadeLevel * 8);
    updateHud();
    return n;
  }

  /**
   * Collapse columns with fall offsets, spawn new gems above with fall distance.
   * Returns true if anything moved/spawned.
   */
  function gravityAndFill() {
    var moved = false;
    for (var c = 0; c < COLS; c++) {
      var stack = [];
      for (var r = ROWS - 1; r >= 0; r--) {
        if (board[r][c]) {
          stack.push({ tile: board[r][c], fromR: r });
          board[r][c] = null;
        }
      }
      var write = ROWS - 1;
      for (var i = 0; i < stack.length; i++) {
        var item = stack[i];
        var toR = write;
        board[toR][c] = item.tile;
        board[toR][c].vy = (item.fromR - toR) * CELL;
        if (item.fromR !== toR) moved = true;
        write--;
      }
      var spawn = 0;
      for (var r = write; r >= 0; r--) {
        spawn++;
        board[r][c] = makeTile(randColor(), TYPE.NORMAL);
        board[r][c].vy = -spawn * CELL;
        moved = true;
      }
    }
    return moved;
  }

  function animateFalls() {
    var starts = {};
    var any = false;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var t = board[r][c];
        if (t && t.vy) {
          starts[r + "," + c] = t.vy;
          any = true;
        }
      }
    }
    if (!any) return Promise.resolve();
    return new Promise(function (resolve) {
      var t0 = performance.now();
      function frame(now) {
        var u = Math.min(1, (now - t0) / FALL_MS);
        // ease-out cubic (gravity feel)
        var e = 1 - Math.pow(1 - u, 3);
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            var t = board[r][c];
            if (!t) continue;
            var k = r + "," + c;
            if (starts[k] != null) t.vy = starts[k] * (1 - e);
            else t.vy = 0;
          }
        }
        draw();
        if (u < 1) {
          requestAnimationFrame(frame);
        } else {
          for (var r = 0; r < ROWS; r++) {
            for (var c = 0; c < COLS; c++) {
              if (board[r][c]) board[r][c].vy = 0;
            }
          }
          draw();
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function resolveBoard(opts) {
    opts = opts || {};
    cascadeLevel = 0;
    var safety = 0;

    function step() {
      if (safety++ > 50) {
        cascadeLevel = 0;
        return Promise.resolve();
      }
      var match = findMatches();
      if (!match.clear.length) {
        cascadeLevel = 0;
        // Auto-shuffle only when stuck, and only once (not from inside a shuffle resolve)
        if (!hasAnyMove() && !opts.fromShuffle) {
          setStatus("No moves — reshuffling & scoring…", "");
          return reshuffleAndScore();
        }
        if (!hasAnyMove() && opts.fromShuffle) {
          // Last resort: rebuild a playable board without free points
          var t = 0;
          while (!hasAnyMove() && t++ < 10) fillStable();
          draw();
        }
        return Promise.resolve();
      }
      cascadeLevel++;
      var detonated = {};
      match.clear.forEach(function (k) {
        var p = k.split(",");
        var r = parseInt(p[0], 10);
        var c = parseInt(p[1], 10);
        if (board[r][c] && board[r][c].type !== TYPE.NORMAL) {
          activateTile(r, c, board[r][c].color, detonated);
        } else {
          detonated[k] = true;
        }
      });
      var specs = match.specials.slice();
      clearKeys(Object.keys(detonated));
      // Place only the planned specials (1 per run) where the match scored
      specs.forEach(function (sp) {
        if (inBounds(sp.r, sp.c)) {
          board[sp.r][sp.c] = makeTile(sp.color, sp.type);
        }
      });
      scoreFocus = null;
      draw();
      setStatus(
        cascadeLevel > 1 ? "Chain ×" + cascadeLevel + "! Score " + score : "Match! Score " + score,
        "ok"
      );
      postPresence();
      return delay(POP_MS).then(function () {
        gravityAndFill();
        return animateFalls().then(function () {
          return step();
        });
      });
    }
    return step();
  }

  function hasAnyMove() {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (c + 1 < COLS && trySwapSim(r, c, r, c + 1)) return true;
        if (r + 1 < ROWS && trySwapSim(r, c, r + 1, c)) return true;
      }
    }
    return false;
  }

  function trySwapSim(r1, c1, r2, c2) {
    if (!board[r1][c1] || !board[r2][c2]) return false;
    var a = board[r1][c1];
    var b = board[r2][c2];
    if (a.type !== TYPE.NORMAL || b.type !== TYPE.NORMAL) return true;
    board[r1][c1] = b;
    board[r2][c2] = a;
    var m = findMatches();
    board[r1][c1] = a;
    board[r2][c2] = b;
    return m.clear.length > 0;
  }

  function shuffleTilesInPlace() {
    var tiles = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (board[r][c]) {
          tiles.push({
            color: board[r][c].color,
            type: board[r][c].type === TYPE.COLOR ? TYPE.NORMAL : board[r][c].type,
          });
        }
      }
    }
    // Prefer reshuffling normals so specials don't strand the board oddly
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].type !== TYPE.NORMAL && Math.random() < 0.5) {
        tiles[i].type = TYPE.NORMAL;
      }
    }
    for (var i = tiles.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = tiles[i];
      tiles[i] = tiles[j];
      tiles[j] = t;
    }
    var k = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var src = tiles[k++] || { color: randColor(), type: TYPE.NORMAL };
        board[r][c] = makeTile(src.color, src.type);
        // Drop-in animation from above
        board[r][c].vy = -(ROWS - r + 1 + (c % 3)) * CELL * 0.35 - Math.random() * 20;
      }
    }
  }

  /**
   * Shuffle board, animate falls, then resolve any matches so scoring happens.
   */
  function reshuffle() {
    var tries = 0;
    do {
      shuffleTilesInPlace();
      tries++;
      // Prefer a layout that still has moves after any immediate matches settle
      // (we score those matches next via resolveBoard)
    } while (tries < 12 && !hasAnyMove() && !findMatches().clear.length);

    if (!hasAnyMove() && !findMatches().clear.length) {
      fillStable();
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
          if (board[r][c]) board[r][c].vy = -(r + 2) * CELL * 0.4;
        }
      }
    }
    draw();
    return animateFalls();
  }

  /** Reshuffle then clear/score any matches that landed (cascades included). */
  function reshuffleAndScore() {
    scoreFocus = null;
    var scoreBefore = score;
    return reshuffle()
      .then(function () {
        var m = findMatches();
        if (m.clear.length) {
          setStatus("Shuffle match! Scoring…", "ok");
          return resolveBoard({ fromShuffle: true });
        }
        if (!hasAnyMove()) {
          var t = 0;
          while (!hasAnyMove() && t++ < 10) fillStable();
        }
        setStatus("Reshuffled — no free matches. Keep swapping! Score " + score, "ok");
        return null;
      })
      .then(function () {
        draw();
        updateHud();
        postPresence();
        var gained = score - scoreBefore;
        if (gained > 0) {
          setStatus("Shuffle scored +" + gained + " · total " + score, "ok");
        }
      });
  }

  /** Candy Crush match-5: color popper + a type → clear every gem of that type. */
  function markAllOfColor(color, detonated) {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var t = board[r][c];
        if (!t) continue;
        if (t.type === TYPE.COLOR) continue;
        if (t.color === color) detonated[r + "," + c] = true;
      }
    }
  }

  function handleSpecialSwap(r1, c1, r2, c2) {
    var a = board[r1][c1];
    var b = board[r2][c2];
    if (!a || !b) return false;
    var detonated = {};

    // COLOR + COLOR → clear whole board
    if (a.type === TYPE.COLOR && b.type === TYPE.COLOR) {
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) detonated[r + "," + c] = true;
      }
      clearKeys(Object.keys(detonated));
      return true;
    }

    // COLOR popper mixed with another gem (Candy Crush: wipe that color type)
    if (a.type === TYPE.COLOR || b.type === TYPE.COLOR) {
      var popper = a.type === TYPE.COLOR ? { r: r1, c: c1 } : { r: r2, c: c2 };
      var other = a.type === TYPE.COLOR ? { r: r2, c: c2, t: b } : { r: r1, c: c1, t: a };
      var targetColor = other.t.color;
      detonated[popper.r + "," + popper.c] = true;
      detonated[other.r + "," + other.c] = true;

      if (other.t.type === TYPE.STRIPE_H || other.t.type === TYPE.STRIPE_V) {
        // All of that color become stripes, then fire (mix power-ups)
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            if (board[r][c] && board[r][c].color === targetColor && board[r][c].type === TYPE.NORMAL) {
              board[r][c].type = other.t.type;
            }
          }
        }
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            if (board[r][c] && board[r][c].color === targetColor) {
              activateTile(r, c, targetColor, detonated);
            }
          }
        }
      } else if (other.t.type === TYPE.BOMB) {
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            if (board[r][c] && board[r][c].color === targetColor && board[r][c].type === TYPE.NORMAL) {
              board[r][c].type = TYPE.BOMB;
            }
          }
        }
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            if (board[r][c] && board[r][c].color === targetColor) {
              activateTile(r, c, targetColor, detonated);
            }
          }
        }
      } else {
        // Classic: popper + normal gem of type X → every X gone
        markAllOfColor(targetColor, detonated);
      }
      clearKeys(Object.keys(detonated));
      return true;
    }

    if (
      (a.type === TYPE.STRIPE_H || a.type === TYPE.STRIPE_V) &&
      (b.type === TYPE.STRIPE_H || b.type === TYPE.STRIPE_V)
    ) {
      for (var x = 0; x < COLS; x++) {
        detonated[r1 + "," + x] = true;
        detonated[r2 + "," + x] = true;
      }
      for (var y = 0; y < ROWS; y++) {
        detonated[y + "," + c1] = true;
        detonated[y + "," + c2] = true;
      }
      clearKeys(Object.keys(detonated));
      return true;
    }

    if (
      ((a.type === TYPE.STRIPE_H || a.type === TYPE.STRIPE_V) && b.type === TYPE.BOMB) ||
      ((b.type === TYPE.STRIPE_H || b.type === TYPE.STRIPE_V) && a.type === TYPE.BOMB)
    ) {
      var cr = r2;
      var cc = c2;
      for (var dr = -1; dr <= 1; dr++) {
        var rr = cr + dr;
        if (rr >= 0 && rr < ROWS) {
          for (var x = 0; x < COLS; x++) detonated[rr + "," + x] = true;
        }
        var col = cc + dr;
        if (col >= 0 && col < COLS) {
          for (var y = 0; y < ROWS; y++) detonated[y + "," + col] = true;
        }
      }
      clearKeys(Object.keys(detonated));
      return true;
    }

    if (a.type === TYPE.BOMB && b.type === TYPE.BOMB) {
      for (var dr = -2; dr <= 2; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          if (inBounds(r1 + dr, c1 + dc)) detonated[r1 + dr + "," + (c1 + dc)] = true;
          if (inBounds(r2 + dr, c2 + dc)) detonated[r2 + dr + "," + (c2 + dc)] = true;
        }
      }
      clearKeys(Object.keys(detonated));
      return true;
    }

    return false;
  }

  function swapTiles(r1, c1, r2, c2) {
    var t = board[r1][c1];
    board[r1][c1] = board[r2][c2];
    board[r2][c2] = t;
  }

  function tryPlayerSwap(r1, c1, r2, c2) {
    if (busy) return;
    if (!adjacent({ r: r1, c: c1 }, { r: r2, c: c2 })) return;
    if (!board[r1][c1] || !board[r2][c2]) return;

    busy = true;
    // Power-up lands where the player scored the swap (destination)
    scoreFocus = { r: r2, c: c2 };
    swapTiles(r1, c1, r2, c2);
    draw();

    var a = board[r1][c1];
    var b = board[r2][c2];
    var specialMix =
      a &&
      b &&
      (a.type === TYPE.COLOR ||
        b.type === TYPE.COLOR ||
        (a.type !== TYPE.NORMAL && b.type !== TYPE.NORMAL));

    if (specialMix && handleSpecialSwap(r1, c1, r2, c2)) {
      draw();
      delay(POP_MS)
        .then(function () {
          gravityAndFill();
          return animateFalls();
        })
        .then(function () {
          return resolveBoard();
        })
        .then(function () {
          busy = false;
          selected = null;
          scoreFocus = null;
          draw();
          setStatus("Combo chain! Score " + score, "ok");
          postPresence();
        });
      return;
    }

    var match = findMatches();
    if (!match.clear.length) {
      swapTiles(r1, c1, r2, c2);
      draw();
      busy = false;
      selected = null;
      scoreFocus = null;
      setStatus("No match — try another pair.", "err");
      return;
    }

    resolveBoard().then(function () {
      busy = false;
      selected = null;
      scoreFocus = null;
      draw();
      setStatus("Chain complete · score " + score, "ok");
      postPresence();
    });
  }

  // ——— Drawing ———

  function drawRoundedRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawTile(r, c, t) {
    var baseX = PAD + c * CELL;
    var baseY = PAD + r * CELL;
    var vy = t.vy || 0;
    var x = baseX;
    var y = baseY + vy;
    var inset = 3;
    var size = CELL - inset * 2;
    var cx = x + CELL / 2;
    var cy = y + CELL / 2;

    // Color popper (match-5) is its own multicolor orb — not a type skin
    if (t.type === TYPE.COLOR) {
      var g = ctx.createRadialGradient(cx - 6, cy - 8, 2, cx, cy, size * 0.42);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.25, "#ff66cc");
      g.addColorStop(0.55, "#66aaff");
      g.addColorStop(0.8, "#ffcc44");
      g.addColorStop(1, "#8844ff");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // hint rings
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      var skin = gemSkins[t.color];
      if (skin) {
        ctx.drawImage(skin, x + inset, y + inset, size, size);
      } else {
        var hue = gemMeta[t.color] ? gemMeta[t.color].hue : t.color * 60;
        ctx.fillStyle = "hsla(" + hue + ",75%,52%,0.95)";
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.38, 0, Math.PI * 2);
        ctx.fill();
      }

      // Special overlays on stylized gems
      if (t.type === TYPE.STRIPE_H) {
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 3;
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 2;
        for (var i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(cx - size * 0.28, cy + i * 5);
          ctx.lineTo(cx + size * 0.28, cy + i * 5);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      } else if (t.type === TYPE.STRIPE_V) {
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 3;
        for (var i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(cx + i * 5, cy - size * 0.28);
          ctx.lineTo(cx + i * 5, cy + size * 0.28);
          ctx.stroke();
        }
      } else if (t.type === TYPE.BOMB) {
        ctx.strokeStyle = "rgba(255,220,80,0.98)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,160,40,0.4)";
        ctx.fill();
      }
    }

    if (selected && selected.r === r && selected.c === c) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      drawRoundedRect(x + 2, y + 2, CELL - 4, CELL - 4, 12);
      ctx.stroke();
    }
  }

  function draw() {
    if (!ctx || !canvas) return;
    var W = canvas.width;
    var H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // board wells
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var x = PAD + c * CELL;
        var y = PAD + r * CELL;
        ctx.fillStyle = (r + c) % 2 === 0 ? "rgba(48,28,46,0.95)" : "rgba(36,20,38,0.95)";
        drawRoundedRect(x + 1, y + 1, CELL - 2, CELL - 2, 8);
        ctx.fill();
      }
    }
    // clip falling gems slightly above board
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (board[r][c]) drawTile(r, c, board[r][c]);
      }
    }
    ctx.restore();
  }

  function cellFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / rect.width;
    var sy = canvas.height / rect.height;
    var x = (ev.clientX - rect.left) * sx - PAD;
    var y = (ev.clientY - rect.top) * sy - PAD;
    var c = Math.floor(x / CELL);
    var r = Math.floor(y / CELL);
    if (!inBounds(r, c)) return null;
    return { r: r, c: c };
  }

  function onPointer(ev) {
    if (busy || !canvas) return;
    var cell = cellFromEvent(ev);
    if (!cell) return;
    if (!selected) {
      selected = cell;
      draw();
      return;
    }
    if (selected.r === cell.r && selected.c === cell.c) {
      selected = null;
      draw();
      return;
    }
    if (adjacent(selected, cell)) {
      var s = selected;
      selected = null;
      tryPlayerSwap(s.r, s.c, cell.r, cell.c);
    } else {
      selected = cell;
      draw();
    }
  }

  function newGame() {
    score = 0;
    cascadeLevel = 0;
    selected = null;
    busy = false;
    scoreFocus = null;
    fillStable();
    if (!hasAnyMove()) fillStable();
    updateHud();
    draw();
    setStatus("Match 3+ · one power-up per run · chains · lives ∞ · scores sync on LAN", "ok");
    postPresence();
  }

  function bind() {
    canvas = $("mt-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    canvas.width = PAD * 2 + COLS * CELL;
    canvas.height = PAD * 2 + ROWS * CELL;
    canvas.addEventListener("click", onPointer);
    loadPlayerIdentity();
    $("mt-new-game") && $("mt-new-game").addEventListener("click", newGame);
    $("mt-gen-shapes") &&
      $("mt-gen-shapes").addEventListener("click", function () {
        if (busy) return;
        generateShapes({ skipUpload: false });
      });
    $("mt-reshuffle") &&
      $("mt-reshuffle").addEventListener("click", function () {
        if (busy) return;
        busy = true;
        selected = null;
        setStatus("Shuffling…", "");
        reshuffleAndScore()
          .then(function () {
            busy = false;
            draw();
            var m = findMatches();
            if (!m.clear.length) {
              setStatus("Reshuffled · score " + score + " · keep matching!", "ok");
            }
          })
          .catch(function () {
            busy = false;
            setStatus("Shuffle failed — try again.", "err");
          });
      });
    $("mt-player-name") &&
      $("mt-player-name").addEventListener("change", function () {
        playerName = String($("mt-player-name").value || "Player").trim().slice(0, 40) || "Player";
        savePlayerIdentity();
        postPresence();
        setStatus("Playing as " + playerName, "ok");
      });
    $("mt-player-name") &&
      $("mt-player-name").addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          $("mt-player-name").blur();
        }
      });

    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "match") postPresence();
      else postPresence();
    });

    function start() {
      newGame();
      startNetworkLoop();
      var loadSkins = function () {
        // Prefer network skins if server already has a set
        pollNetwork().then(function () {
          if (!gemMeta.length) generateShapes({ skipUpload: false });
        });
      };
      if (window.galleryManifest && window.galleryManifest.length) {
        loadSkins();
      } else if (window.loadGalleryData) {
        window.loadGalleryData().then(loadSkins).catch(loadSkins);
      } else {
        window.addEventListener("gallery-data-ready", loadSkins, { once: true });
        setTimeout(loadSkins, 600);
      }
    }
    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.Match = { newGame: newGame, generateShapes: generateShapes };
})();
