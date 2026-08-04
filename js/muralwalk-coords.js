/**
 * Muralwalk world/screen coordinate math only — no painting numbers.
 */
(function () {
  if (window.MuralwalkCoords) return;
  var SPEED = 3.2;
  var ORB_R = 40;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function coordHash(x, y) {
    var h = x * 374761393 + y * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function cameraCenter(w, h) {
    return { x: w / 2, y: h / 2 };
  }

  function worldToScreen(wx, wy, camWx, camWy, w, h) {
    var c = cameraCenter(w, h);
    return { x: c.x + (wx - camWx), y: c.y + (wy - camWy) };
  }

  function screenToWorld(sx, sy, camWx, camWy, w, h) {
    var c = cameraCenter(w, h);
    return { x: camWx + (sx - c.x), y: camWy + (sy - c.y) };
  }

  function updateCamera(camWx, camWy, wx, wy, lerp) {
    if (lerp == null) lerp = 0.14;
    return {
      camWx: camWx + (wx - camWx) * lerp,
      camWy: camWy + (wy - camWy) * lerp,
    };
  }

  function dist(ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function normalize(dx, dy) {
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { dx: dx / len, dy: dy / len, len: len };
  }

  function pushCircle(px, py, cx, cy, minR) {
    var dx = px - cx;
    var dy = py - cy;
    var d2 = dx * dx + dy * dy;
    if (d2 >= minR * minR) return { x: px, y: py };
    var d = Math.sqrt(d2) || 1;
    return { x: cx + (dx / d) * minR, y: cy + (dy / d) * minR };
  }

  function uvFromWorld(wx, wy) {
    return {
      u: 0.5 + wx * 0.0018,
      v: 0.5 + wy * 0.0018,
    };
  }

  function gridScroll(wx, wy, step) {
    return {
      ox: -(((wx % step) + step) % step),
      oy: -(((wy % step) + step) % step),
    };
  }

  function visibleInRect(sx, sy, w, h, margin) {
    margin = margin == null ? 0 : margin;
    return sx > -margin && sy > -margin && sx < w + margin && sy < h + margin;
  }

  function orbOffset(i, salt) {
    salt = salt == null ? 99 : salt;
    return {
      ox: (coordHash(i, salt) % 50) - 25,
      oy: (coordHash(salt, i) % 50) - 25,
    };
  }

  function orbWorldPos(i, ring, ang, px, py) {
    var off = orbOffset(i);
    return {
      x: px + Math.cos(ang) * ring + off.ox,
      y: py + Math.sin(ang) * ring + off.oy,
    };
  }

  function orbSpawnRing(idx, worldSeed) {
    return 55 + (coordHash(idx, worldSeed) % 200);
  }

  function orbSpawnAngle(idx, scoreSalt) {
    return (coordHash(idx, scoreSalt + 7) % 628) / 100;
  }

  var ENTITY_ANGLES = [0.55, 1.9, 3.4, 4.8, 5.9, 2.6, 0.2, 3.9];

  function entityPlacement(index, worldSeed, variant) {
    var i = index;
    return {
      angle: ENTITY_ANGLES[i % ENTITY_ANGLES.length] + variant * 0.12 + (i % 3) * 0.08,
      dist: 200 + i * 95 + (coordHash(i, worldSeed) % 70),
      phase: (coordHash(i, 7) % 628) / 100,
      speed: 0.55 + (coordHash(i, 9) % 8) / 10,
      patrolR: 48 + (coordHash(i, 3) % 50),
      sizeBias: coordHash(i, worldSeed + 17) % 48,
    };
  }

  function obstacleFallbackPlacement(oi) {
    return {
      angle: 1.1 + oi * 1.35,
      dist: 260 + oi * 80,
      slot: oi,
    };
  }

  function enemyFallbackPlacement(ei) {
    return {
      angle: 2.4 + ei * 2.1,
      dist: 320 + ei * 100,
      patrolR: 55 + ei * 20,
      phase: ei,
      speed: 0.75,
      slot: ei + 2,
    };
  }

  var PROP_ANGLES = [-Math.PI / 2, Math.PI / 6, (Math.PI * 2) / 3];

  function propWorldPos(slot, dist) {
    var ang = PROP_ANGLES[slot % 3];
    return {
      x: Math.cos(ang) * dist,
      y: Math.sin(ang) * dist,
      angle: ang,
    };
  }

  function visionCrop(slot, worldSeed, variant) {
    return {
      cropWFrac: 0.34 + (coordHash(slot, variant) % 12) / 100,
      cropHFrac: 0.34 + (coordHash(variant, slot) % 12) / 100,
      u: clamp(0.12 + slot * 0.24 + (variant % 4) * 0.05, 0.05, 0.62),
      v: clamp(0.14 + (coordHash(slot, worldSeed) % 50) / 100, 0.05, 0.62),
      tilt: ((coordHash(slot, worldSeed + 3) % 16) - 8) * 0.012,
    };
  }

  function entityDrawSize(base, index, worldSeed, variant, spread) {
    spread = spread == null ? 36 : spread;
    return base + (coordHash(index, variant + worldSeed) % spread);
  }

  function patrolStep(ent, wx, wy, t) {
    ent.phase += 0.018 * ent.speed;
    ent.x = ent.patrolX + Math.cos(ent.phase) * ent.patrolR;
    ent.y = ent.patrolY + Math.sin(ent.phase) * ent.patrolR;
    var dx = wx - ent.x;
    var dy = wy - ent.y;
    var d = dist(wx, wy, ent.x, ent.y) || 1;
    if (d < 240 && d > 36) {
      ent.patrolX += (dx / d) * ent.speed * 0.35;
      ent.patrolY += (dy / d) * ent.speed * 0.35;
    }
    if (d < 34) {
      return pushCircle(wx, wy, ent.x, ent.y, 38);
    }
    return { x: wx, y: wy };
  }

  window.MuralwalkCoords = {
    SPEED: SPEED,
    ORB_R: ORB_R,
    clamp: clamp,
    coordHash: coordHash,
    cameraCenter: cameraCenter,
    worldToScreen: worldToScreen,
    screenToWorld: screenToWorld,
    updateCamera: updateCamera,
    dist: dist,
    normalize: normalize,
    pushCircle: pushCircle,
    uvFromWorld: uvFromWorld,
    gridScroll: gridScroll,
    visibleInRect: visibleInRect,
    orbWorldPos: orbWorldPos,
    orbSpawnRing: orbSpawnRing,
    orbSpawnAngle: orbSpawnAngle,
    entityPlacement: entityPlacement,
    obstacleFallbackPlacement: obstacleFallbackPlacement,
    enemyFallbackPlacement: enemyFallbackPlacement,
    propWorldPos: propWorldPos,
    visionCrop: visionCrop,
    entityDrawSize: entityDrawSize,
    patrolStep: patrolStep,
  };
})();