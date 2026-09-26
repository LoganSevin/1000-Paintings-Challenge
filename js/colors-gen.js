/**
 * Colors — 3-tone generator.
 * Pick 3 swatches in the Colors pager (tone tray), then Generate: the prompt is built
 * internally from the 3 tones only (hex + human-readable names) plus "any subject",
 * with a rolled subject so every generate differs. No prompt box.
 *
 * Same generation path as Spellforge:
 *   POST /api/generate-stasis-vision  (Netlify function / PC server; account-gate.js adds
 *   the visitor's X-Visitor-Xai-Key header on the public site) → 202 + job_id →
 *   poll GET /api/jobs/:id → image URL (often a data: URL).
 * Same saving as Spellforge's persistGeneratedStill:
 *   POST /api/save-generated-image (same origin on localhost, else API base /
 *   127.0.0.1:8765 / localhost:8765) → gallery/generated/N.jpg + sidecar meta, tagged
 *   with the 3 tones; else an already-linked "generated" folder; else on screen only.
 */
(function () {
  "use strict";

  var ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];
  var GEN_KEY = "colorsGen.v1"; // { aspect }
  var POLL_MS = 2000;
  var PC_GENERATED_HINT = "Desktop\\1000 Paintings Challenge\\gallery\\generated";

  // Broad subjects — rolled per generate so repeats differ. The tones stay the brief.
  var SUBJECTS = [
    "a sweeping landscape at an unusual hour",
    "a quiet still life on a tabletop",
    "a portrait of an invented character",
    "a creature that has never existed",
    "a city street after rain",
    "an underwater world",
    "a cosmic scene among planets and nebulae",
    "a cozy interior room",
    "a botanical study of strange plants",
    "a mythic hero mid-journey",
    "a fantastical vehicle or flying machine",
    "a storm rolling over the sea",
    "a festival crowd at night",
    "an ancient temple lost in a forest",
    "a futuristic skyline",
    "a pure abstract composition of shapes and rhythm",
    "a lone figure in a vast desert",
    "a mountain village in snow",
    "a surreal dreamscape",
    "a bustling market",
    "a garden with a hidden doorway",
    "animals gathered at a watering hole",
    "a lighthouse on a cliff",
    "a dancer caught mid-motion",
    "a robot tending to a garden",
    "a castle on floating islands",
    "a coral reef teeming with life",
    "a train crossing a high bridge",
    "a bird's-eye view of winding rivers",
    "a musician playing on a rooftop",
    "a close-up of a single flower",
    "a giant whale drifting through clouds",
    "an alchemist's workshop",
    "a carnival of masks",
    "a sleepy fishing harbor",
    "a knight facing a dragon",
    "a still pond reflecting a moonrise",
    "a greenhouse full of light",
    "a cat asleep in a sunbeam",
    "an autumn forest path",
    "a sci-fi explorer on an alien planet",
    "a tea house by a waterfall",
    "geometric crystals growing in a cave",
    "a hot-air balloon race",
    "an owl in a moonlit tree",
    "a sailing ship in a storm of stars",
    "a jazz club at midnight",
    "a field of wildflowers under wind",
  ];

  // CSS named colors (spaced), for "closest named color".
  var NAMED = (
    "black:000000,dim gray:696969,gray:808080,dark gray:a9a9a9,silver:c0c0c0,light gray:d3d3d3,gainsboro:dcdcdc,white smoke:f5f5f5,white:ffffff," +
    "snow:fffafa,ivory:fffff0,linen:faf0e6,beige:f5f5dc,old lace:fdf5e6,seashell:fff5ee,mint cream:f5fffa,azure mist:f0ffff,alice blue:f0f8ff,lavender blush:fff0f5,misty rose:ffe4e1," +
    "maroon:800000,dark red:8b0000,firebrick:b22222,crimson:dc143c,red:ff0000,indian red:cd5c5c,light coral:f08080,salmon:fa8072,dark salmon:e9967a,light salmon:ffa07a," +
    "orange red:ff4500,tomato:ff6347,coral:ff7f50,dark orange:ff8c00,orange:ffa500,gold:ffd700,yellow:ffff00,light yellow:ffffe0,lemon chiffon:fffacd,light goldenrod:fafad2," +
    "papaya whip:ffefd5,moccasin:ffe4b5,peach puff:ffdab9,pale goldenrod:eee8aa,khaki:f0e68c,dark khaki:bdb76b,olive:808000,yellow green:9acd32,olive drab:6b8e23,dark olive green:556b2f," +
    "green yellow:adff2f,chartreuse:7fff00,lawn green:7cfc00,lime:00ff00,lime green:32cd32,pale green:98fb98,light green:90ee90,medium spring green:00fa9a,spring green:00ff7f,medium sea green:3cb371," +
    "sea green:2e8b57,forest green:228b22,green:008000,dark green:006400,medium aquamarine:66cdaa,dark sea green:8fbc8f,light sea green:20b2aa,dark cyan:008b8b,teal:008080,aquamarine:7fffd4," +
    "cyan:00ffff,light cyan:e0ffff,pale turquoise:afeeee,turquoise:40e0d0,medium turquoise:48d1cc,dark turquoise:00ced1,cadet blue:5f9ea0,powder blue:b0e0e6,light blue:add8e6,sky blue:87ceeb," +
    "light sky blue:87cefa,deep sky blue:00bfff,steel blue:4682b4,dodger blue:1e90ff,cornflower blue:6495ed,royal blue:4169e1,blue:0000ff,medium blue:0000cd,dark blue:00008b,navy:000080," +
    "midnight blue:191970,slate blue:6a5acd,dark slate blue:483d8b,medium slate blue:7b68ee,medium purple:9370db,rebecca purple:663399,blue violet:8a2be2,indigo:4b0082,dark orchid:9932cc,dark violet:9400d3," +
    "medium orchid:ba55d3,thistle:d8bfd8,plum:dda0dd,violet:ee82ee,magenta:ff00ff,orchid:da70d6,dark magenta:8b008b,purple:800080,medium violet red:c71585,deep pink:ff1493," +
    "hot pink:ff69b4,light pink:ffb6c1,pink:ffc0cb,pale violet red:db7093,lavender:e6e6fa,cornsilk:fff8dc,blanched almond:ffebcd,bisque:ffe4c4,navajo white:ffdead,wheat:f5deb3," +
    "burlywood:deb887,tan:d2b48c,rosy brown:bc8f8f,sandy brown:f4a460,goldenrod:daa520,dark goldenrod:b8860b,peru:cd853f,chocolate:d2691e,saddle brown:8b4513,sienna:a0522d," +
    "brown:a52a2a,slate gray:708090,light slate gray:778899,dark slate gray:2f4f4f,light steel blue:b0c4de"
  )
    .split(",")
    .map(function (pair) {
      var p = pair.split(":");
      return { name: p[0], rgb: hexToRgb("#" + p[1]) };
    });

  // ---- color naming -----------------------------------------------------------

  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "");
    return {
      r: parseInt(h.slice(0, 2), 16) || 0,
      g: parseInt(h.slice(2, 4), 16) || 0,
      b: parseInt(h.slice(4, 6), 16) || 0,
    };
  }

  function rgbToHsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var d = max - min;
    var h = 0, s = 0;
    if (d > 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: s, l: l };
  }

  function nearestNamed(c) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < NAMED.length; i++) {
      var n = NAMED[i].rgb;
      var rm = (c.r + n.r) / 2;
      var dr = c.r - n.r, dg = c.g - n.g, db = c.b - n.b;
      // "redmean" weighted distance — cheap and close to perceptual
      var d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bestD) {
        bestD = d;
        best = NAMED[i].name;
      }
    }
    return best;
  }

  function hueWord(h, s, l) {
    if (h < 10 || h >= 350) return l < 0.3 ? "oxblood red" : l > 0.72 ? "pink" : "red";
    if (h < 22) return l < 0.35 ? "rust brown" : l > 0.72 ? "peach" : "vermilion";
    if (h < 40) return l < 0.4 ? "brown" : l > 0.75 ? "apricot" : "orange";
    if (h < 50) return l < 0.35 ? "bronze" : l > 0.75 ? "cream" : "amber";
    if (h < 65) return l < 0.35 ? "olive" : l > 0.8 ? "butter yellow" : "yellow";
    if (h < 85) return l < 0.35 ? "moss green" : "lime";
    if (h < 105) return "chartreuse green";
    if (h < 145) return l < 0.3 ? "forest green" : "green";
    if (h < 165) return "emerald";
    if (h < 180) return "teal";
    if (h < 195) return l > 0.7 ? "aqua" : "cyan";
    if (h < 215) return l > 0.7 ? "sky blue" : "azure";
    if (h < 240) return l < 0.3 ? "navy blue" : "blue";
    if (h < 258) return "ultramarine";
    if (h < 275) return l > 0.72 ? "lavender" : "violet";
    if (h < 295) return "purple";
    if (h < 318) return "magenta";
    if (h < 335) return s > 0.6 && l >= 0.35 ? "hot pink" : "plum";
    return l > 0.7 ? "rose pink" : "crimson rose";
  }

  /** Human-readable name + description for a hex color. */
  function nameColor(hex) {
    var c = hexToRgb(hex);
    var hsl = rgbToHsl(c);
    var h = hsl.h, s = hsl.s, l = hsl.l;
    var name;
    if (s < 0.1 || l < 0.04 || l > 0.97) {
      name =
        l < 0.06 ? "black" : l < 0.2 ? "charcoal" : l < 0.4 ? "dark gray" : l < 0.62 ? "gray" :
        l < 0.82 ? "silver gray" : l < 0.96 ? "off-white" : "white";
      if (s >= 0.04 && l >= 0.06 && l <= 0.96) name = (h < 70 || h >= 300 ? "warm " : "cool ") + name;
    } else {
      var mods = [];
      if (l < 0.18) mods.push("very dark");
      else if (l < 0.32) mods.push("deep");
      else if (l > 0.85) mods.push("pale");
      else if (l > 0.68) mods.push("light");
      if (s < 0.3) mods.push("dusty");
      else if (s < 0.55) mods.push("muted");
      else if (s > 0.85 && l >= 0.32 && l <= 0.68) mods.push("vivid");
      name = (mods.length ? mods.join(" ") + " " : "") + hueWord(h, s, l);
    }
    return { hex: String(hex).toUpperCase(), rgb: c, name: name, nearest: nearestNamed(c) };
  }

  // ---- prompt -------------------------------------------------------------------

  function pickSubject(prev) {
    var pick = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
    if (pick === prev && SUBJECTS.length > 1) return pickSubject(prev);
    return pick;
  }

  /**
   * Internal prompt from the 3 tones only (+ a rolled subject for variety).
   * Returns { stasis, buzz_words, names }.
   */
  function buildPrompt(tones, subject) {
    var names = tones.map(function (t) {
      return nameColor(t.hex);
    });
    var lines = names.map(function (n, i) {
      return (
        "• Tone " + (i + 1) + ": " + n.hex + " — " + n.name +
        " (RGB " + n.rgb.r + ", " + n.rgb.g + ", " + n.rgb.b + "; closest named color: " + n.nearest + ")"
      );
    });
    var stasis =
      "THREE-TONE PAINTING — the palette is the entire brief.\n" +
      "Use only these three colors as the dominant palette, each clearly present in roughly balanced amounts. " +
      "Tints, shades and blends of these three are fine for light and depth; introduce no other hues.\n" +
      lines.join("\n") +
      "\nSubject: anything at all — this time, " + subject + ". Invent it freely, in any style or era.\n" +
      "Let the three tones set the mood, light and composition. " +
      "No text, letters, labels, color swatches or palette charts anywhere in the image.";
    var buzz = ["three-tone palette", "limited palette"];
    names.forEach(function (n) {
      buzz.push(n.name);
      buzz.push(n.hex);
    });
    return { stasis: stasis, buzz_words: buzz.slice(0, 16), names: names };
  }

  // ---- api (same helpers/semantics as Spellforge) ------------------------------

  function isLocalHost() {
    var h = (location.hostname || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function apiBase() {
    return String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
  }

  function apiUrl(path) {
    var base = apiBase();
    return base ? base + path : path;
  }

  function parseApiResponse(res) {
    return res.text().then(function (text) {
      var t = (text || "").trim();
      if (!t || t.charAt(0) === "<") throw new Error("AI API not available on this link yet.");
      try {
        return JSON.parse(t);
      } catch (e) {
        throw new Error("Invalid server response from the image API.");
      }
    });
  }

  function errText(d, status) {
    var e = d && d.error;
    var m = (e && e.message) || e || "Generate failed (HTTP " + status + ")";
    return typeof m === "string" ? m : JSON.stringify(m);
  }

  function pollJob(jobId, onStatus, attemptsLeft) {
    return new Promise(function (resolve, reject) {
      if (attemptsLeft <= 0) {
        reject(new Error("Timed out waiting for xAI. Try Generate again."));
        return;
      }
      fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("Job status HTTP " + r.status);
          return r.json();
        })
        .then(function (job) {
          var st = String((job && job.status) || "working");
          onStatus(st === "queued" || st === "pending" ? "xAI generating… (" + st + ")" : "Generating… (" + st + ")");
          if (st === "done") {
            var img = (job.images && job.images[0]) || job.image;
            if (img && img.url) return resolve(img.url);
            return reject(new Error("Job done but no image URL returned."));
          }
          if (st === "failed" || st === "error") {
            return reject(new Error(errText(job, 200)));
          }
          setTimeout(function () {
            pollJob(jobId, onStatus, attemptsLeft - 1).then(resolve, reject);
          }, POLL_MS);
        })
        .catch(function (err) {
          if (attemptsLeft > 3) {
            setTimeout(function () {
              pollJob(jobId, onStatus, attemptsLeft - 1).then(resolve, reject);
            }, POLL_MS);
            return;
          }
          reject(err);
        });
    });
  }

  function requestImage(body, onStatus) {
    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    }).then(function (r) {
      return parseApiResponse(r).then(function (d) {
        var attempts = isLocalHost() ? 100 : 150;
        if (r.status === 202) return pollJob((d && d.job_id) || body.job_id, onStatus, attempts);
        if (!r.ok) throw new Error(errText(d, r.status));
        var img = d.image || (d.images && d.images[0]);
        if (img && img.url) return img.url;
        if (d && d.job_id) return pollJob(d.job_id, onStatus, attempts);
        throw new Error("No image returned");
      });
    });
  }

  // ---- saving (mirrors Spellforge persistGeneratedStill) -----------------------

  function pcSaveBases() {
    if (isLocalHost()) return [""];
    var bases = [];
    if (apiBase()) bases.push(apiBase());
    bases.push("http://127.0.0.1:8765", "http://localhost:8765");
    return bases.filter(function (b, i) {
      return bases.indexOf(b) === i;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(fr.result);
      };
      fr.onerror = function () {
        resolve(null);
      };
      fr.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl || "").split(",");
    var m = (parts[0] || "").match(/data:([^;]+)/);
    var bin = atob(parts[1] || "");
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m ? m[1] : "image/jpeg" });
  }

  function urlToBlob(url) {
    if (String(url).indexOf("data:") === 0) return Promise.resolve(dataUrlToBlob(url));
    return fetch(url, { mode: "cors", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("fetch");
        return r.blob();
      })
      .catch(function () {
        return null;
      });
  }

  function postSave(base, payload) {
    var opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      mode: "cors",
    };
    try {
      opts.targetAddressSpace = "loopback";
    } catch (e) {}
    return fetch((base || "") + "/api/save-generated-image", opts).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || (d && d.ok === false)) throw new Error((d && d.error) || "Save failed");
        return d;
      });
    });
  }

  /** Linked "generated" folder shared with Spellforge (IndexedDB spellforge-pc-drop). */
  function linkedFolder() {
    if (!window.showDirectoryPicker || !window.indexedDB) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var req;
      try {
        req = indexedDB.open("spellforge-pc-drop", 1);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
      };
      req.onerror = function () {
        resolve(null);
      };
      req.onsuccess = function () {
        try {
          var get = req.result.transaction("kv", "readonly").objectStore("kv").get("generatedFolder");
          get.onsuccess = function () {
            resolve(get.result || null);
          };
          get.onerror = function () {
            resolve(null);
          };
        } catch (e) {
          resolve(null);
        }
      };
    }).then(function (h) {
      if (!h || !h.queryPermission) return null;
      return h.queryPermission({ mode: "readwrite" }).then(function (perm) {
        if (perm === "granted") return h;
        if (perm === "prompt" && h.requestPermission) {
          return h.requestPermission({ mode: "readwrite" }).then(function (n) {
            return n === "granted" ? h : null;
          }, function () {
            return null;
          });
        }
        return null;
      });
    }).catch(function () {
      return null;
    });
  }

  function writeToFolder(dir, blob) {
    var max = 0;
    var it = dir.values();
    function step() {
      return Promise.resolve(it.next()).then(function (res) {
        if (res.done) return max + 1;
        var m = String((res.value && res.value.name) || "").match(/^(\d+)\.(jpe?g|png|webp)$/i);
        if (m) max = Math.max(max, parseInt(m[1], 10));
        return step();
      });
    }
    return step().then(function (n) {
      var name = n + ".jpg";
      return dir.getFileHandle(name, { create: true }).then(function (fh) {
        return fh.createWritable().then(function (w) {
          return w.write(blob).then(function () {
            return w.close();
          });
        });
      }).then(function () {
        return name;
      });
    });
  }

  function persistStill(url, job) {
    var payload = {
      source: "colors",
      collection: "generated",
      reveal: false,
      description: job.prompt.stasis.slice(0, 800),
      meta: {
        source: "colors",
        generator: "3-tone",
        tones: job.prompt.names.map(function (n, i) {
          var t = job.tones[i] || {};
          return { hex: n.hex, name: n.name, nearest: n.nearest, orig: t.orig || n.hex, spell: t.spell || null, order: t.order || "" };
        }),
        palette_hex: job.prompt.names.map(function (n) {
          return n.hex;
        }),
        subject: job.subject,
        aspect: job.aspect,
        spells: [],
      },
    };
    return urlToBlob(url).then(function (blob) {
      job.blob = blob;
      var prep = blob
        ? blobToDataUrl(blob).then(function (d) {
            if (d) payload.image_base64 = d;
            else payload.image_url = url;
          })
        : Promise.resolve((payload.image_url = url));
      return prep.then(function () {
        var bases = pcSaveBases();
        function tryNext(i) {
          if (i >= bases.length) return Promise.resolve(null);
          return postSave(bases[i], payload).then(null, function () {
            return tryNext(i + 1);
          });
        }
        return tryNext(0);
      }).then(function (d) {
        if (d && d.name) {
          return { via: "studio", name: d.name, num: d.num, url: d.url };
        }
        if (!blob) return null;
        return linkedFolder().then(function (dir) {
          if (!dir) return null;
          return writeToFolder(dir, blob).then(function (name) {
            return { via: "folder", name: name };
          }, function () {
            return null;
          });
        });
      });
    }).then(null, function () {
      return null;
    });
  }

  // ---- UI -----------------------------------------------------------------------

  var el = {};
  var busy = false;
  var lastSubject = "";
  var jobs = []; // newest first
  var lastRequest = null; // for tests / debugging

  function $(id) {
    return document.getElementById(id);
  }

  function loadAspect() {
    try {
      var p = JSON.parse(localStorage.getItem(GEN_KEY) || "null");
      if (p && ASPECTS.indexOf(p.aspect) >= 0) return p.aspect;
    } catch (e) {}
    return "1:1";
  }

  function saveAspect(a) {
    try {
      localStorage.setItem(GEN_KEY, JSON.stringify({ aspect: a }));
    } catch (e) {}
  }

  function currentTones() {
    return window.Colors && window.Colors.getTones ? window.Colors.getTones() : [null, null, null];
  }

  function textColorFor(hex) {
    var c = hexToRgb(hex);
    return c.r * 0.299 + c.g * 0.587 + c.b * 0.114 < 128 ? "#fff" : "#000";
  }

  function renderTray() {
    if (!el.tray) return;
    var tones = currentTones();
    el.tray.innerHTML = "";
    tones.forEach(function (t, i) {
      var li = document.createElement("li");
      li.className = "clr-tone-slot" + (t ? " is-filled" : "");
      li.setAttribute("data-slot", String(i));
      var chip = document.createElement("span");
      chip.className = "clr-tone-chip";
      chip.setAttribute("aria-hidden", "true");
      var label = document.createElement("span");
      label.className = "clr-tone-label";
      if (t) {
        var n = nameColor(t.hex);
        chip.style.background = t.hex; // shorthand: replaces the empty-slot stripe image
        chip.style.color = textColorFor(t.hex);
        chip.textContent = String(i + 1);
        var hx = document.createElement("code");
        hx.className = "clr-tone-hex";
        hx.textContent = t.hex;
        var nm = document.createElement("span");
        nm.className = "clr-tone-name";
        nm.textContent = n.name;
        label.appendChild(hx);
        label.appendChild(nm);
        var x = document.createElement("button");
        x.type = "button";
        x.className = "clr-tone-x";
        x.setAttribute("aria-label", "Remove tone " + (i + 1) + " " + t.hex);
        x.textContent = "×";
        x.addEventListener("click", function () {
          if (window.Colors) window.Colors.removeTone(i);
        });
        li.appendChild(chip);
        li.appendChild(label);
        li.appendChild(x);
      } else {
        chip.textContent = String(i + 1);
        label.textContent = "Tone " + (i + 1) + " — empty";
        li.appendChild(chip);
        li.appendChild(label);
      }
      el.tray.appendChild(li);
    });
    var full = tones.every(Boolean);
    el.go.disabled = busy || !full;
    el.reroll.disabled = busy || !full;
    el.reroll.hidden = !jobs.length;
    if (!busy && !el.status.classList.contains("clr-err")) {
      var n = tones.filter(Boolean).length;
      if (!full) {
        el.status.textContent = n ? "Add " + (3 - n) + " more tone" + (3 - n === 1 ? "" : "s") + " to generate." : "";
      } else if (!el.status.textContent || /^Add \d/.test(el.status.textContent)) {
        el.status.textContent = "Ready — Generate paints anything, in these 3 tones only.";
      }
    }
  }

  function setStatus(msg, isErr) {
    el.status.textContent = msg || "";
    el.status.classList.toggle("clr-err", !!isErr);
  }

  function toneList(names) {
    var ul = document.createElement("ul");
    ul.className = "clr-gen-tones";
    names.forEach(function (n, i) {
      var li = document.createElement("li");
      var chip = document.createElement("span");
      chip.className = "clr-tone-chip";
      chip.style.background = n.hex;
      chip.style.color = textColorFor(n.hex);
      chip.textContent = String(i + 1);
      chip.setAttribute("aria-hidden", "true");
      var txt = document.createElement("span");
      txt.className = "clr-tone-label";
      var hx = document.createElement("code");
      hx.className = "clr-tone-hex";
      hx.textContent = n.hex;
      var nm = document.createElement("span");
      nm.className = "clr-tone-name";
      nm.textContent = n.name;
      txt.appendChild(hx);
      txt.appendChild(nm);
      li.appendChild(chip);
      li.appendChild(txt);
      ul.appendChild(li);
    });
    return ul;
  }

  function buildCard(job) {
    var card = document.createElement("article");
    card.className = "clr-gen-card is-pending";
    var media = document.createElement("div");
    media.className = "clr-gen-media";
    media.style.aspectRatio = job.aspect.replace(":", " / ");
    var ph = document.createElement("div");
    ph.className = "clr-gen-placeholder";
    ph.style.background =
      "linear-gradient(135deg, " + job.prompt.names.map(function (n) { return n.hex; }).join(", ") + ")";
    var phText = document.createElement("span");
    phText.textContent = "Generating…";
    ph.appendChild(phText);
    media.appendChild(ph);
    var side = document.createElement("div");
    side.className = "clr-gen-side";
    var h = document.createElement("p");
    h.className = "clr-gen-kicker";
    h.textContent = "3 tones";
    side.appendChild(h);
    side.appendChild(toneList(job.prompt.names));
    var subj = document.createElement("p");
    subj.className = "clr-gen-subject";
    subj.textContent = "Subject roll: " + job.subject;
    side.appendChild(subj);
    var save = document.createElement("p");
    save.className = "clr-gen-save";
    save.setAttribute("aria-live", "polite");
    side.appendChild(save);
    var actions = document.createElement("div");
    actions.className = "clr-gen-actions";
    var again = document.createElement("button");
    again.type = "button";
    again.className = "clr-btn clr-btn-sm clr-gen-again";
    again.textContent = "↻ Reroll these tones";
    again.addEventListener("click", function () {
      generate(job.tones);
    });
    actions.appendChild(again);
    side.appendChild(actions);
    card.appendChild(media);
    card.appendChild(side);
    job.card = card;
    job.els = { media: media, ph: ph, phText: phText, save: save, actions: actions, again: again };
    return card;
  }

  function showImage(job, url) {
    var img = document.createElement("img");
    img.className = "clr-gen-img";
    img.alt = "Generated painting in " + job.prompt.names.map(function (n) { return n.name + " " + n.hex; }).join(", ");
    img.src = url;
    var link = document.createElement("a");
    link.className = "clr-gen-img-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.appendChild(img);
    job.els.media.innerHTML = "";
    job.els.media.appendChild(link);
    job.card.classList.remove("is-pending");
    var dl = document.createElement("a");
    dl.className = "clr-btn clr-btn-sm clr-gen-download";
    dl.href = url;
    dl.download = "three-tone-" + job.prompt.names.map(function (n) { return n.hex.slice(1); }).join("-") + ".jpg";
    dl.textContent = "Download";
    job.els.actions.appendChild(dl);
  }

  function setSaveStatus(job, res) {
    var s = job.els.save;
    var old = job.els.actions.querySelector(".clr-gen-savebtn");
    if (old) old.remove();
    if (res && res.via === "studio") {
      s.textContent = "Saved to Generated as " + res.name + (res.num != null ? " (G#" + res.num + ")" : "") + " — tagged with these 3 tones.";
      s.classList.remove("clr-err");
      return;
    }
    if (res && res.via === "folder") {
      s.textContent = "Saved as " + res.name + " in " + PC_GENERATED_HINT + ".";
      s.classList.remove("clr-err");
      return;
    }
    s.textContent = "On screen only — the PC gallery server didn't answer.";
    s.classList.add("clr-err");
    var b = document.createElement("button");
    b.type = "button";
    b.className = "clr-btn clr-btn-sm clr-gen-savebtn";
    b.textContent = "Save to PC";
    b.addEventListener("click", function () {
      s.textContent = "Saving…";
      s.classList.remove("clr-err");
      persistStill(job.url, job).then(function (r) {
        setSaveStatus(job, r);
      });
    });
    job.els.actions.insertBefore(b, job.els.actions.firstChild.nextSibling);
  }

  function isKeyError(msg) {
    return /api key|xai key|credit|spending limit|billing|license|purchase|unauthori[sz]ed|401|403/i.test(String(msg || ""));
  }

  /** xAI refused the key itself (the server says "Your saved xAI key was rejected…" or passes xAI's text). */
  function isRejectedKey(msg) {
    return /saved xai key was rejected|incorrect api key|invalid api key|api key is invalid/i.test(String(msg || ""));
  }

  function isCreditsMsg(msg) {
    return /used all available credits|spending limit|purchase more credits|credit/i.test(String(msg || ""));
  }

  function savedVisitorKey() {
    try {
      return (window.AccountGate && window.AccountGate.getVisitorXaiKey && window.AccountGate.getVisitorXaiKey()) || "";
    } catch (e) {
      return "";
    }
  }

  /** Same clear as the Grok / xAI tabs: drop every l7in_xai_key_* entry in this browser. */
  function forgetSavedKeys() {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf("l7in_xai_key_") === 0) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  /** Plain-language status for key / billing failures. */
  function friendlyKeyMessage(msg) {
    var rejected = isRejectedKey(msg);
    var credits = isCreditsMsg(msg);
    if (rejected && credits) {
      return "xAI rejected the key saved in this browser, and the site's own key is out of credits. Reconnect a valid xAI key (console.x.ai) to generate.";
    }
    if (rejected) {
      return "xAI rejected the key saved in this browser. Reconnect a valid key from console.x.ai, or forget it to use the site's key.";
    }
    if (credits) {
      return "The xAI account used for this generate is out of credits or at its spending limit. Connect an xAI key with credits to keep generating.";
    }
    return msg;
  }

  /** Generate from the given tones (default: the tray). */
  function generate(tonesArg) {
    if (busy) return Promise.resolve(null);
    var tones = (tonesArg || currentTones()).filter(Boolean);
    if (tones.length < 3) {
      setStatus("Pick 3 tones first.", true);
      return Promise.resolve(null);
    }
    if (location.protocol === "file:") {
      setStatus("Cannot generate from a file:// page — open the site over http(s).", true);
      return Promise.resolve(null);
    }
    tones = tones.slice(0, 3);
    var subject = pickSubject(lastSubject);
    lastSubject = subject;
    var aspect = ASPECTS.indexOf(el.aspect.value) >= 0 ? el.aspect.value : "1:1";
    var prompt = buildPrompt(tones, subject);
    var jobId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "job-" + Date.now();
    var hexes = prompt.names.map(function (n) {
      return n.hex;
    });
    // Same body shape as Spellforge's generateStasisVisionCloud — text only, no references.
    var body = {
      job_id: jobId,
      stasis: prompt.stasis,
      prompt: prompt.stasis,
      fused_prompt: prompt.stasis,
      buzz_words: prompt.buzz_words,
      spells: [],
      spell_details: [],
      palette_hex: hexes,
      aspect_ratio: aspect,
      mag_fresh: true,
      fresh_variation: true,
      spell_cast: false,
      attach_references: false,
      reference_image: "",
      spell_reference_image: "",
      source: "colors",
      product_mode: "three_tone",
    };
    lastRequest = body;
    var job = { id: jobId, tones: tones, subject: subject, aspect: aspect, prompt: prompt, url: "" };
    jobs.unshift(job);
    el.results.hidden = false;
    el.list.insertBefore(buildCard(job), el.list.firstChild);
    busy = true;
    el.keyRow.hidden = true;
    setStatus("Calling xAI for a 3-tone painting…");
    renderTray();
    var started = Date.now();
    var tick = setInterval(function () {
      job.els.phText.textContent = "Generating… " + Math.round((Date.now() - started) / 1000) + "s";
    }, 1000);
    return requestImage(body, function (msg) {
      setStatus(msg);
    })
      .then(function (url) {
        job.url = url;
        showImage(job, url);
        setStatus("Done — saving to Generated…");
        job.els.save.textContent = "Saving to Generated…";
        return persistStill(url, job).then(function (res) {
          setSaveStatus(job, res);
          setStatus(res ? "Done." : "Done — not saved to the PC gallery (see card).", false);
          return url;
        });
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err || "Generate failed");
        if (/failed to fetch|networkerror|load failed/i.test(msg)) {
          msg = "Could not reach the image API. Check your connection and try again.";
        }
        job.card.classList.add("is-failed");
        job.els.phText.textContent = "Failed";
        job.els.save.textContent = msg; // raw server/xAI text stays on the card
        job.els.save.classList.add("clr-err");
        var keyTrouble = isKeyError(msg) && window.AccountGate && !isLocalHost();
        setStatus(keyTrouble ? friendlyKeyMessage(msg) : msg, true);
        if (keyTrouble) {
          el.keyRow.hidden = false;
          if (el.forget) el.forget.hidden = !savedVisitorKey();
        }
        return null;
      })
      .then(function (r) {
        clearInterval(tick);
        busy = false;
        renderTray();
        return r;
      });
  }

  function init() {
    el.tray = $("clr-tone-tray");
    el.go = $("clr-gen-go");
    el.reroll = $("clr-gen-reroll");
    el.aspect = $("clr-gen-aspect");
    el.status = $("clr-gen-status");
    el.keyRow = $("clr-gen-key");
    el.connect = $("clr-gen-connect");
    el.forget = $("clr-gen-forget");
    el.results = $("clr-gen-results");
    el.list = $("clr-gen-list");
    if (!el.tray || !el.go || !el.list) return;
    el.aspect.value = loadAspect();
    el.aspect.addEventListener("change", function () {
      saveAspect(el.aspect.value);
    });
    el.go.addEventListener("click", function () {
      generate();
    });
    el.reroll.addEventListener("click", function () {
      generate();
    });
    if (el.connect) {
      el.connect.addEventListener("click", function () {
        if (window.AccountGate && window.AccountGate.promptKeyAsync) {
          window.AccountGate.promptKeyAsync().then(function (ok) {
            if (ok) {
              el.keyRow.hidden = true;
              setStatus("Key connected — press Generate.");
            }
          });
        }
      });
    }
    if (el.forget) {
      el.forget.addEventListener("click", function () {
        forgetSavedKeys();
        el.forget.hidden = true;
        el.keyRow.hidden = true;
        setStatus("Saved key removed from this browser — Generate will use the site's key.");
      });
    }
    window.addEventListener("colors-tones-change", function () {
      if (el.status.classList.contains("clr-err") && !busy) setStatus("");
      renderTray();
    });
    renderTray();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.ColorsGen = {
    nameColor: nameColor,
    buildPrompt: buildPrompt,
    pickSubject: pickSubject,
    SUBJECTS: SUBJECTS.slice(),
    generate: generate,
    getLastRequest: function () {
      return lastRequest;
    },
    getJobs: function () {
      return jobs.map(function (j) {
        return { id: j.id, subject: j.subject, aspect: j.aspect, url: j.url, tones: j.tones };
      });
    },
  };
})();
