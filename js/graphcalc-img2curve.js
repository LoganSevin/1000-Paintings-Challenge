/**
 * Image → cubic Bézier parametric curves (img2desmos-style).
 * Edge detect → thin → contours → light simplify → Catmull-Rom → (x(t),y(t)).
 */
(function () {
  "use strict";

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    return path;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Could not load image (CORS or missing file)"));
      };
      img.src = src;
    });
  }

  function imageToCanvas(img, maxW) {
    maxW = maxW || 480;
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    // Prefer longer side cap so portraits keep resolution
    var long = Math.max(w, h);
    if (long > maxW) {
      var s = maxW / long;
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
    }
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  }

  function getGray(data, i) {
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  function boxBlurGray(gray, w, h, r) {
    r = r || 1;
    var tmp = new Float32Array(w * h);
    var out = new Float32Array(w * h);
    var x, y, i, s, n;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        s = 0;
        n = 0;
        for (i = -r; i <= r; i++) {
          s += gray[y * w + clamp(x + i, 0, w - 1)];
          n++;
        }
        tmp[y * w + x] = s / n;
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        s = 0;
        n = 0;
        for (i = -r; i <= r; i++) {
          s += tmp[clamp(y + i, 0, h - 1) * w + x];
          n++;
        }
        out[y * w + x] = s / n;
      }
    }
    return out;
  }

  function sobelEdges(gray, w, h) {
    var mag = new Float32Array(w * h);
    var maxM = 0;
    var sum = 0;
    var count = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var gx =
          -gray[i - w - 1] +
          gray[i - w + 1] -
          2 * gray[i - 1] +
          2 * gray[i + 1] -
          gray[i + w - 1] +
          gray[i + w + 1];
        var gy =
          -gray[i - w - 1] -
          2 * gray[i - w] -
          gray[i - w + 1] +
          gray[i + w - 1] +
          2 * gray[i + w] +
          gray[i + w + 1];
        var m = Math.sqrt(gx * gx + gy * gy);
        mag[i] = m;
        if (m > maxM) maxM = m;
        sum += m;
        count++;
      }
    }
    return { mag: mag, max: maxM || 1, mean: count ? sum / count : 0 };
  }

  /** Dual-threshold (Canny-style) so more weak edges attach to strong ones. */
  function hysteresisThreshold(mag, w, h, maxM, mean, detail) {
    // detail 1..10: higher → lower thresholds → more edges
    var hiFrac = 0.26 - detail * 0.018;
    var loFrac = hiFrac * 0.38;
    var high = Math.max(maxM * hiFrac, mean * (1.8 - detail * 0.08));
    var low = Math.max(maxM * loFrac, mean * 0.55);
    var strong = new Uint8Array(w * h);
    var weak = new Uint8Array(w * h);
    var i;
    for (i = 0; i < mag.length; i++) {
      if (mag[i] >= high) strong[i] = 1;
      else if (mag[i] >= low) weak[i] = 1;
    }
    // Promote weak neighbors of strong
    var changed = true;
    var guard = 0;
    while (changed && guard++ < 40) {
      changed = false;
      for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
          var ii = y * w + x;
          if (!weak[ii] || strong[ii]) continue;
          var hit = false;
          for (var dy = -1; dy <= 1 && !hit; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (strong[(y + dy) * w + (x + dx)]) {
                hit = true;
                break;
              }
            }
          }
          if (hit) {
            strong[ii] = 1;
            weak[ii] = 0;
            changed = true;
          }
        }
      }
    }
    return strong;
  }

  /**
   * Zhang-Suen thinning — turns fat edges into 1px skeletons so contour walk
   * keeps more separate strokes instead of swallowing them.
   */
  function thinBinary(bin, w, h) {
    var img = new Uint8Array(bin);
    var changed = true;
    var iter = 0;
    function A(p) {
      // p is 9-neighborhood array 1..8
      var n = 0;
      for (var i = 1; i <= 8; i++) {
        var j = i === 8 ? 1 : i + 1;
        if (p[i] === 0 && p[j] === 1) n++;
      }
      return n;
    }
    function B(p) {
      var n = 0;
      for (var i = 1; i <= 8; i++) n += p[i];
      return n;
    }
    while (changed && iter++ < 32) {
      changed = false;
      var toClear = [];
      var pass;
      for (pass = 0; pass < 2; pass++) {
        toClear = [];
        for (var y = 1; y < h - 1; y++) {
          for (var x = 1; x < w - 1; x++) {
            var i0 = y * w + x;
            if (!img[i0]) continue;
            var p = [0];
            p[1] = img[(y - 1) * w + x];
            p[2] = img[(y - 1) * w + (x + 1)];
            p[3] = img[y * w + (x + 1)];
            p[4] = img[(y + 1) * w + (x + 1)];
            p[5] = img[(y + 1) * w + x];
            p[6] = img[(y + 1) * w + (x - 1)];
            p[7] = img[y * w + (x - 1)];
            p[8] = img[(y - 1) * w + (x - 1)];
            var b = B(p);
            if (b < 2 || b > 6) continue;
            if (A(p) !== 1) continue;
            if (pass === 0) {
              if (p[1] * p[3] * p[5] !== 0) continue;
              if (p[3] * p[5] * p[7] !== 0) continue;
            } else {
              if (p[1] * p[3] * p[7] !== 0) continue;
              if (p[1] * p[5] * p[7] !== 0) continue;
            }
            toClear.push(i0);
          }
        }
        if (toClear.length) {
          changed = true;
          for (var k = 0; k < toClear.length; k++) img[toClear[k]] = 0;
        }
      }
    }
    return img;
  }

  var N8 = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];

  function extractContours(bin, w, h, minLen) {
    minLen = minLen || 8;
    var visited = new Uint8Array(w * h);
    var contours = [];

    function at(x, y) {
      return y * w + x;
    }

    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i0 = at(x, y);
        if (!bin[i0] || visited[i0]) continue;
        // Prefer start at endpoint (1 neighbor) to reduce fragmenting
        var neigh = 0;
        var d0;
        for (d0 = 0; d0 < 8; d0++) {
          if (bin[at(x + N8[d0][0], y + N8[d0][1])]) neigh++;
        }
        // Skip interior-ish starts when better endpoints exist — still allow junctions
        var path = [];
        var cx = x;
        var cy = y;
        var guard = 0;
        var prevDir = 0;
        while (guard++ < w * h) {
          var ii = at(cx, cy);
          if (cx < 1 || cy < 1 || cx >= w - 1 || cy >= h - 1) break;
          if (!bin[ii] || visited[ii]) break;
          visited[ii] = 1;
          path.push({ x: cx, y: cy });
          var found = false;
          var k;
          // Search preferred direction first, then neighbors
          for (k = 0; k < 8; k++) {
            var d = (prevDir + (k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -(k / 2))) % 8;
            if (d < 0) d += 8;
            var nx = cx + N8[d][0];
            var ny = cy + N8[d][1];
            if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
            var ni = at(nx, ny);
            if (bin[ni] && !visited[ni]) {
              cx = nx;
              cy = ny;
              prevDir = d;
              found = true;
              break;
            }
          }
          if (!found) {
            for (k = 0; k < 8; k++) {
              var nx2 = cx + N8[k][0];
              var ny2 = cy + N8[k][1];
              if (nx2 < 1 || ny2 < 1 || nx2 >= w - 1 || ny2 >= h - 1) continue;
              var ni2 = at(nx2, ny2);
              if (bin[ni2] && !visited[ni2]) {
                cx = nx2;
                cy = ny2;
                prevDir = k;
                found = true;
                break;
              }
            }
          }
          if (!found) break;
        }
        if (path.length >= minLen) contours.push(path);
      }
    }
    contours.sort(function (a, b) {
      return b.length - a.length;
    });
    return contours;
  }

  function rdp(points, epsilon) {
    if (points.length < 3) return points.slice();
    var eps2 = epsilon * epsilon;
    function rec(pts) {
      if (pts.length < 3) return pts.slice();
      var first = pts[0];
      var last = pts[pts.length - 1];
      var maxD = 0;
      var idx = 0;
      var dx = last.x - first.x;
      var dy = last.y - first.y;
      var len2 = dx * dx + dy * dy || 1;
      for (var i = 1; i < pts.length - 1; i++) {
        var t = ((pts[i].x - first.x) * dx + (pts[i].y - first.y) * dy) / len2;
        t = clamp(t, 0, 1);
        var px = first.x + t * dx;
        var py = first.y + t * dy;
        var d =
          (pts[i].x - px) * (pts[i].x - px) + (pts[i].y - py) * (pts[i].y - py);
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (maxD > eps2) {
        var left = rec(pts.slice(0, idx + 1));
        var right = rec(pts.slice(idx));
        return left.slice(0, -1).concat(right);
      }
      return [first, last];
    }
    return rec(points);
  }

  function catmullToBezier(p0, p1, p2, p3) {
    return {
      p0: { x: p1.x, y: p1.y },
      p1: {
        x: p1.x + (p2.x - p0.x) / 6,
        y: p1.y + (p2.y - p0.y) / 6,
      },
      p2: {
        x: p2.x - (p3.x - p1.x) / 6,
        y: p2.y - (p3.y - p1.y) / 6,
      },
      p3: { x: p2.x, y: p2.y },
    };
  }

  function fmtNum(n) {
    // 2 decimals keeps sketches accurate without huge expressions
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function bezierToDesmos(b) {
    function coord(a, c1, c2, d) {
      return (
        "(1 - t)^3*" +
        fmtNum(a) +
        " + 3*t*(1 - t)^2*" +
        fmtNum(c1) +
        " + 3*t^2*(1 - t)*" +
        fmtNum(c2) +
        " + t^3*" +
        fmtNum(d)
      );
    }
    return (
      "(" +
      coord(b.p0.x, b.p1.x, b.p2.x, b.p3.x) +
      "," +
      coord(b.p0.y, b.p1.y, b.p2.y, b.p3.y) +
      ")"
    );
  }

  function polylineToBeziers(points) {
    if (points.length < 2) return [];
    var pts = points.slice();
    if (pts.length === 2) {
      var a = pts[0];
      var b = pts[1];
      return [
        {
          p0: a,
          p1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
          p2: { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
          p3: b,
        },
      ];
    }
    var ext = [pts[0]].concat(pts, [pts[pts.length - 1]]);
    var out = [];
    for (var i = 0; i < ext.length - 3; i++) {
      out.push(catmullToBezier(ext[i], ext[i + 1], ext[i + 2], ext[i + 3]));
    }
    return out;
  }

  function imageToBezierExprs(imgOrUrl, opts) {
    opts = opts || {};
    var detail = clamp(opts.detail != null ? opts.detail : 6, 1, 10);
    var maxCurves = opts.maxCurves != null ? opts.maxCurves : 800;
    var maxWidth = opts.maxWidth != null ? opts.maxWidth : 520;

    var load =
      typeof imgOrUrl === "string"
        ? loadImage(imgOrUrl)
        : Promise.resolve(imgOrUrl);

    return load.then(function (img) {
      var canvas = imageToCanvas(img, maxWidth);
      var w = canvas.width;
      var h = canvas.height;
      var ctx = canvas.getContext("2d");
      var imageData = ctx.getImageData(0, 0, w, h);
      var data = imageData.data;
      var gray = new Float32Array(w * h);
      for (var i = 0, p = 0; i < data.length; i += 4, p++) {
        gray[p] = getGray(data, i);
      }
      // Light blur only — heavy blur erases fine lines
      var blurred = boxBlurGray(gray, w, h, detail >= 8 ? 0 : 1);
      if (detail >= 8) blurred = gray;
      var edges = sobelEdges(blurred, w, h);
      var bin = hysteresisThreshold(edges.mag, w, h, edges.max, edges.mean, detail);
      bin = thinBinary(bin, w, h);

      var minLen = Math.max(6, 14 - detail);
      var contours = extractContours(bin, w, h, minLen);
      // Light simplify only — high epsilon was dropping shape
      var eps = 0.45 + (11 - detail) * 0.22;

      var exprs = [];
      var flipY = opts.flipY !== false;
      for (var c = 0; c < contours.length && exprs.length < maxCurves; c++) {
        var simplified = rdp(contours[c], eps);
        // Keep more vertices: if RDP over-simplified, use denser resample
        if (simplified.length < 2) continue;
        if (simplified.length < 4 && contours[c].length > 20) {
          // take every Nth original point
          var step = Math.max(1, Math.floor(contours[c].length / 24));
          simplified = [];
          for (var si = 0; si < contours[c].length; si += step) {
            simplified.push(contours[c][si]);
          }
          var last = contours[c][contours[c].length - 1];
          if (
            !simplified.length ||
            simplified[simplified.length - 1].x !== last.x ||
            simplified[simplified.length - 1].y !== last.y
          ) {
            simplified.push(last);
          }
        }
        var mapped = simplified.map(function (pt) {
          return {
            x: pt.x,
            y: flipY ? h - 1 - pt.y : pt.y,
          };
        });
        var beziers = polylineToBeziers(mapped);
        for (var b = 0; b < beziers.length && exprs.length < maxCurves; b++) {
          exprs.push(bezierToDesmos(beziers[b]));
        }
      }

      var prev = document.createElement("canvas");
      prev.width = w;
      prev.height = h;
      var pctx = prev.getContext("2d");
      var prevData = pctx.createImageData(w, h);
      for (var j = 0; j < bin.length; j++) {
        var v = bin[j] ? 0 : 255;
        prevData.data[j * 4] = v;
        prevData.data[j * 4 + 1] = v;
        prevData.data[j * 4 + 2] = v;
        prevData.data[j * 4 + 3] = 255;
      }
      pctx.putImageData(prevData, 0, 0);

      return {
        exprs: exprs,
        width: w,
        height: h,
        preview: prev,
        contourCount: contours.length,
      };
    });
  }

  /**
   * Full-range catalog for sketch picker:
   * - paintings: always 1..1000 → /paintings/N.jpg
   * - generated: every number from dream-pool (1..total, not a 80-item slice)
   */
  function fetchGalleryCatalog(collection) {
    var key = String(collection || "").toLowerCase();
    if (key === "paintings") {
      var items = [];
      for (var n = 1; n <= 1000; n++) {
        items.push({
          id: "paintings/" + n,
          number: n,
          url: "/paintings/" + n + ".jpg",
          title: "Painting #" + n,
        });
      }
      return Promise.resolve({
        collection: "paintings",
        first: 1,
        last: 1000,
        count: 1000,
        items: items,
        files: null,
      });
    }
    if (key === "generated") {
      return fetch(apiUrl("/api/dream-pool?t=" + Date.now()), { cache: "no-store" })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          var nums = Array.isArray(data.generated_nums)
            ? data.generated_nums.slice()
            : [];
          var files = data.generated_files || {};
          nums.sort(function (a, b) {
            return a - b;
          });
          var items = nums.map(function (n) {
            var name = files[String(n)] || n + ".jpg";
            return {
              id: "generated/" + n,
              number: n,
              url: "/generated/" + name,
              title: "Generated #" + n,
            };
          });
          var first = nums.length ? nums[0] : 1;
          var last = nums.length ? nums[nums.length - 1] : 0;
          return {
            collection: "generated",
            first: first,
            last: last,
            count: nums.length,
            items: items,
            files: files,
            nums: nums,
          };
        })
        .catch(function () {
          // Fallback: try unbounded gallery-assets
          return fetch(
            apiUrl(
              "/api/gallery-assets?collection=generated&limit=99999&t=" + Date.now()
            ),
            { cache: "no-store" }
          )
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              var items = ((data && data.items) || [])
                .map(function (it) {
                  var n =
                    it.number != null
                      ? Number(it.number)
                      : it.version != null
                        ? Number(it.version)
                        : null;
                  return {
                    id: it.id || it.url,
                    number: n,
                    url: it.url,
                    title: it.title || (n != null ? "Generated #" + n : it.url),
                  };
                })
                .filter(function (it) {
                  return it.url && it.number != null && isFinite(it.number);
                })
                .sort(function (a, b) {
                  return a.number - b.number;
                });
              return {
                collection: "generated",
                first: items.length ? items[0].number : 1,
                last: items.length ? items[items.length - 1].number : 0,
                count: items.length,
                items: items,
                files: null,
                nums: items.map(function (it) {
                  return it.number;
                }),
              };
            });
        });
    }
    return Promise.resolve({
      collection: key,
      first: 1,
      last: 0,
      count: 0,
      items: [],
      files: null,
    });
  }

  /** Resolve painting/generated URL for a specific number. */
  function urlForNumber(collection, num, catalog) {
    var n = parseInt(num, 10);
    if (!isFinite(n) || n < 1) return "";
    var key = String(collection || "").toLowerCase();
    if (key === "paintings") {
      return "/paintings/" + n + ".jpg";
    }
    if (key === "generated") {
      if (catalog && catalog.files && catalog.files[String(n)]) {
        return "/generated/" + catalog.files[String(n)];
      }
      if (catalog && Array.isArray(catalog.items)) {
        for (var i = 0; i < catalog.items.length; i++) {
          if (Number(catalog.items[i].number) === n) return catalog.items[i].url;
        }
      }
      return "/generated/" + n + ".jpg";
    }
    return "";
  }

  // Back-compat alias
  function fetchGalleryItems(collection) {
    return fetchGalleryCatalog(collection).then(function (cat) {
      return cat.items || [];
    });
  }

  window.GraphCalcImgTrace = {
    imageToBezierExprs: imageToBezierExprs,
    fetchGalleryItems: fetchGalleryItems,
    fetchGalleryCatalog: fetchGalleryCatalog,
    urlForNumber: urlForNumber,
    loadImage: loadImage,
  };
})();
