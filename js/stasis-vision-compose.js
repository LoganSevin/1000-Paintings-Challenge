/**
 * Credit-free stasis vision: fuses your equipped paintings in-browser (no xAI/WOMBO).
 */
(function () {
  var W = 1280;
  var H = 720;

  function dimsFromAspect(aspect, maxSide) {
    maxSide = maxSide || 1280;
    var parts = String(aspect || "16:9").split(":");
    var aw = parseFloat(parts[0]);
    var ah = parseFloat(parts[1]);
    if (!(aw > 0) || !(ah > 0)) {
      aw = 16;
      ah = 9;
    }
    var ratio = aw / ah;
    var w;
    var h;
    if (ratio >= 1) {
      w = maxSide;
      h = Math.max(1, Math.round(maxSide / ratio));
    } else {
      h = maxSide;
      w = Math.max(1, Math.round(maxSide * ratio));
    }
    return { w: w, h: h };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h >>> 0);
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var sameOrigin = true;
      try {
        sameOrigin = new URL(url, window.location.href).origin === window.location.origin;
      } catch (e) {
        sameOrigin = url.indexOf("data:") === 0 || url.indexOf("blob:") === 0;
      }
      if (!sameOrigin) img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Could not load painting"));
      };
      img.src = url;
    });
  }

  function paintingUrl(num) {
    if (window.getSpellforgeSpellUrl) return window.getSpellforgeSpellUrl(num);
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function paletteFromBuzz(buzz, stasis) {
    var map = {
      pink: [232, 121, 169],
      purple: [155, 126, 217],
      blue: [90, 140, 220],
      green: [90, 180, 120],
      orange: [230, 150, 80],
      gold: [210, 170, 60],
      red: [200, 90, 90],
      teal: [70, 160, 150],
      dusk: [120, 80, 140],
      dawn: [255, 180, 140],
    };
    var out = [];
    var text = (buzz || []).join(" ") + " " + (stasis || "");
    var lower = text.toLowerCase();
    Object.keys(map).forEach(function (k) {
      if (lower.indexOf(k) >= 0) out.push(map[k]);
    });
    if (!out.length) {
      var h = hashStr(stasis || "fuse");
      out.push([(h % 80) + 80, ((h >> 8) % 60) + 50, ((h >> 16) % 80) + 90]);
    }
    return out;
  }

  function drawCover(ctx, w, h, img, alpha, ox, oy, scale, filter) {
    if (!img || alpha < 0.02) return;
    var iw = img.width;
    var ih = img.height;
    var sc = Math.max(w / iw, h / ih) * scale;
    var dw = iw * sc;
    var dh = ih * sc;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (filter) ctx.filter = filter;
    ctx.drawImage(img, (w - dw) / 2 + ox, (h - dh) / 2 + oy, dw, dh);
    ctx.restore();
  }

  function composePropHero(images, nums, buzz, stasis, slot, dims) {
    dims = dims || { w: W, h: H };
    var cw = dims.w;
    var ch = dims.h;
    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d");
    var img = images[0];
    var pal = paletteFromBuzz(buzz, stasis);
    var seed = hashStr(stasis + nums.join(",") + String(slot || 0));

    ctx.fillStyle = "#0a0908";
    ctx.fillRect(0, 0, cw, ch);

    for (var p = 0; p < pal.length; p++) {
      var rgb = pal[p];
      var px = cw * (0.15 + 0.7 * (((p + seed) % 100) / 100));
      var py = ch * (0.2 + 0.6 * (((p * 3 + seed) % 100) / 100));
      var r = Math.min(cw, ch) * 0.5;
      var grd = ctx.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, "rgba(" + rgb.join(",") + ",0.42)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, cw, ch);
    }

    var hue = (hashStr(stasis) % 36) - 18;
    var sat = 1.12 + (buzz.length ? 0.18 : 0);
    var ox = ((slot || 0) - 1) * cw * 0.05;
    var oy = (slot % 2 === 0 ? -1 : 1) * ch * 0.03;
    drawCover(
      ctx,
      cw,
      ch,
      img,
      0.92,
      ox,
      oy,
      0.88,
      "saturate(" + sat + ") hue-rotate(" + hue + "deg) contrast(1.12)"
    );

    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    if (pal[0]) {
      ctx.fillStyle = "rgba(" + pal[0].join(",") + ",0.22)";
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.restore();

    var vig = ctx.createRadialGradient(
      cw / 2,
      ch / 2,
      Math.min(cw, ch) * 0.12,
      cw / 2,
      ch / 2,
      Math.max(cw, ch) * 0.78
    );
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, cw, ch);

    return canvas.toDataURL("image/jpeg", 0.92);
  }

  function compose(opts) {
    opts = opts || {};
    var nums = (opts.spells || []).slice(0, 3);
    var buzz = opts.buzz_words || [];
    var stasis = opts.stasis || "";
    var dims = dimsFromAspect(opts.aspect_ratio || "16:9", 1280);
    if (!nums.length) {
      return Promise.reject(new Error("No spells for vision."));
    }
    if (nums.length < 2 && !opts.prop) {
      return Promise.reject(new Error("Equip at least 2 spells."));
    }

    return Promise.all(
      nums.map(function (n) {
        return loadImage(paintingUrl(n));
      })
    ).then(function (images) {
      if (opts.prop && images.length === 1) {
        return composePropHero(images, nums, buzz, stasis, opts.slot, dims);
      }
      var cw = dims.w;
      var ch = dims.h;
      var canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext("2d");
      var n = images.length;
      var pal = paletteFromBuzz(buzz, stasis);
      var seed = hashStr(stasis + nums.join(","));

      ctx.fillStyle = "#0a0908";
      ctx.fillRect(0, 0, cw, ch);

      for (var p = 0; p < pal.length; p++) {
        var rgb = pal[p];
        var px = cw * (0.2 + 0.6 * (((p + seed) % 100) / 100));
        var py = ch * (0.25 + 0.5 * (((p * 2 + seed) % 100) / 100));
        var r = Math.min(cw, ch) * 0.45;
        var grd = ctx.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, "rgba(" + rgb.join(",") + ",0.35)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, cw, ch);
      }

      var weights = [];
      var i;
      if (n === 2) {
        weights = [0.52, 0.48];
      } else {
        weights = [0.38, 0.34, 0.28];
      }

      for (i = 0; i < n; i++) {
        var hue = (hashStr(String(nums[i])) % 30) - 15;
        var sat = 1 + (buzz.length ? 0.15 : 0);
        drawCover(
          ctx,
          cw,
          ch,
          images[i],
          weights[i],
          (i - (n - 1) / 2) * cw * 0.04,
          (i % 2 === 0 ? -1 : 1) * ch * 0.02,
          1.04 + i * 0.02,
          "saturate(" + sat + ") hue-rotate(" + hue + "deg) contrast(1.08)"
        );
      }

      if (n >= 2) {
        ctx.save();
        ctx.globalCompositeOperation = "difference";
        ctx.globalAlpha = 0.1;
        drawCover(ctx, cw, ch, images[1], 1, 0, 0, 1.02, null);
        drawCover(ctx, cw, ch, images[0], 1, 0, 0, 1.02, null);
        ctx.restore();
      }

      if (n >= 3) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.globalCompositeOperation = "lighter";
        drawCover(ctx, cw, ch, images[2], 1, cw * 0.08, -ch * 0.03, 0.92, "saturate(1.3)");
        ctx.restore();
      }

      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.12;
      for (i = 0; i < n; i++) {
        drawCover(ctx, cw, ch, images[i], 1, 0, 0, 1.01, null);
      }
      ctx.restore();

      if (pal[0]) {
        ctx.fillStyle =
          "rgba(" + pal[0].join(",") + ",0.08)";
        ctx.globalCompositeOperation = "soft-light";
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.fillStyle = "rgba(10, 9, 8, 0.15)";
      var vig = ctx.createRadialGradient(
        cw / 2,
        ch / 2,
        Math.min(cw, ch) * 0.15,
        cw / 2,
        ch / 2,
        Math.max(cw, ch) * 0.72
      );
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, cw, ch);

      return canvas.toDataURL("image/jpeg", 0.92);
    });
  }

  window.composeStasisVisionLocal = compose;
})();