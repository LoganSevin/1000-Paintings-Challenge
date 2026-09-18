/**
 * Champions — League roster identities. Skins save as Name/0, Name/1, … not generated/N+1.
 */
(function () {
  "use strict";

  var roster = [];
  var selectedId = "";
  var selectedSlug = "";
  var selectedVariant = 0;
  var blendSpells = [null, null, null, null, null];
  var spellPage = 0;
  var SPELL_PAGE = 25;
  var armedSlot = -1;
  var spellQuery = "";
  var spellSource = "all";
  var SLOT_LABELS = ["I", "II", "III", "IV", "V"];
  var query = "";
  var role = "all";
  var busy = false;
  var busyKind = "";
  var busyStarted = 0;
  var busyTimer = 0;

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
    var el = $("lc-status");
    if (el) el.textContent = msg || "";
    var ov = $("lc-busy-msg");
    if (ov && busy) ov.textContent = msg || "";
  }

  function setBusy(on, kind, label) {
    busy = !!on;
    busyKind = on ? kind || "" : "";
    ["lc-cast", "lc-describe", "lc-animate"].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !!on;
    });
    var wrap = $("lc-hero-wrap");
    if (wrap) wrap.classList.toggle("busy", !!on);
    var ov = $("lc-busy");
    if (ov) ov.hidden = !on;
    if (busyTimer) {
      clearInterval(busyTimer);
      busyTimer = 0;
    }
    if (on) {
      busyStarted = Date.now();
      var animBtn = $("lc-animate");
      if (kind === "video" && animBtn) animBtn.textContent = "Animating…";
      var castBtn = $("lc-cast");
      if (kind === "image" && castBtn) castBtn.textContent = "Casting…";
      setStatus(label || (kind === "video" ? "Animating…" : "Working…"));
      busyTimer = setInterval(function () {
        var sec = Math.floor((Date.now() - busyStarted) / 1000);
        var mm = String(Math.floor(sec / 60)).padStart(2, "0");
        var ss = String(sec % 60).padStart(2, "0");
        var base = kind === "video" ? "Animating" : kind === "image" ? "Casting" : "Working";
        var line = base + " " + mm + ":" + ss;
        var t = $("lc-busy-time");
        if (t) t.textContent = line;
        if (kind === "video" && $("lc-animate")) $("lc-animate").textContent = line;
      }, 400);
    } else {
      if ($("lc-animate")) $("lc-animate").textContent = "Animate";
      if ($("lc-cast")) $("lc-cast").textContent = "Cast skin";
    }
  }

  function champById(id) {
    return roster.filter(function (c) {
      return c.id === id;
    })[0];
  }

  function displaySkins(c) {
    return ((c && c.skins) || []).slice().sort(function (a, b) {
      return intIndex(a.ord || a.index) - intIndex(b.ord || b.index);
    });
  }

  function skinBySlug(c, slug) {
    return displaySkins(c).filter(function (s) {
      return String(s.slug || s.folder || "") === String(slug);
    })[0];
  }

  function variantUrl(c, slug, variant) {
    var s = skinBySlug(c, slug);
    if (!s) return (c && (c.splash || c.icon)) || "";
    variant = variant == null ? 0 : intIndex(variant);
    var folder = s.folder || s.slug;
    var file =
      variant === 0 && s.file
        ? s.file
        : "/champions/" + c.id + "/" + folder + "/" + variant + ".jpg";
    var encoded = file
      .split("/")
      .map(function (seg, i) {
        if (i === 0 && seg === "") return "";
        return encodeURIComponent(seg);
      })
      .join("/");
    return encoded + (s.saved_at ? "?v=" + encodeURIComponent(s.saved_at) : "");
  }

  function skinUrl(c, slug) {
    return variantUrl(c, slug || selectedSlug, selectedVariant);
  }

  function visible() {
    var q = query.toLowerCase();
    return roster.filter(function (c) {
      if (role !== "all" && (c.roles || []).indexOf(role) < 0) return false;
      if (!q) return true;
      return (
        String(c.name || "").toLowerCase().indexOf(q) >= 0 ||
        String(c.title || "").toLowerCase().indexOf(q) >= 0 ||
        String(c.id || "").toLowerCase().indexOf(q) >= 0
      );
    });
  }

  function renderGrid() {
    var hold = $("lc-grid");
    if (!hold) return;
    var list = visible();
    if ($("lc-count")) $("lc-count").textContent = list.length + " / " + roster.length;
    hold.innerHTML = "";
    var frag = document.createDocumentFragment();
    list.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className =
        "lc-card" +
        (c.id === selectedId ? " selected" : "") +
        (displaySkins(c).length > 1 ? " has-skin" : "");
      b.title = c.name + " — " + c.title;
      var img = document.createElement("img");
      img.alt = c.name;
      img.loading = "lazy";
      var first = displaySkins(c)[0];
      img.src = first ? variantUrl(c, first.slug, 0) : c.icon || c.splash;
      b.appendChild(img);
      var name = document.createElement("span");
      name.className = "lc-card-name";
      name.textContent = c.name;
      b.appendChild(name);
      var skins = document.createElement("span");
      skins.className = "lc-card-skins";
      var nSkins = displaySkins(c).length;
      skins.textContent = nSkins ? nSkins + " skins" : "no skins yet";
      b.appendChild(skins);
      b.addEventListener("click", function () {
        selectChamp(c.id);
      });
      frag.appendChild(b);
    });
    hold.appendChild(frag);
  }

  function renderSkinStrip(c) {
    var hold = $("lc-skins");
    if (!hold) return;
    hold.innerHTML = "";
    var skins = displaySkins(c);
    if (!skins.length) {
      hold.textContent = "Pull official skins, or Cast to save " + c.id + "/0.jpg";
      return;
    }
    skins.forEach(function (s) {
      var slug = s.slug || s.folder;
      var b = document.createElement("button");
      b.type = "button";
      b.className =
        "lc-skin" + (slug === selectedSlug ? " selected" : "") + (s.source === "studio" ? " studio" : "");
      b.title = (s.ord || "") + ". " + (s.name || slug);
      var img = document.createElement("img");
      img.alt = s.name || slug;
      img.loading = "lazy";
      img.src = variantUrl(c, slug, 0);
      b.appendChild(img);
      var nVar = intIndex(s.variant_count) || (s.variants && s.variants.length) || 1;
      var badge = document.createElement("span");
      badge.className = "lc-var-badge";
      badge.title = nVar + " variant" + (nVar === 1 ? "" : "s") + " in this skin line";
      badge.textContent = String(nVar);
      b.appendChild(badge);
      var lab = document.createElement("span");
      lab.className = "lc-skin-name";
      lab.textContent = String(s.ord || "") + " · " + String(s.name || slug);
      b.appendChild(lab);
      b.addEventListener("click", function () {
        selectedSlug = slug;
        selectedVariant = 0;
        selectChamp(c.id, true);
      });
      hold.appendChild(b);
    });
  }

  function renderVariants(c) {
    var hold = $("lc-variants");
    if (!hold) return;
    hold.innerHTML = "";
    var s = skinBySlug(c, selectedSlug);
    if (!s) return;
    var vars = s.variants && s.variants.length ? s.variants : [0];
    vars.forEach(function (v) {
      v = intIndex(v);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lc-skin" + (v === selectedVariant ? " selected" : "");
      b.title = (s.folder || s.slug) + "/" + v + ".jpg";
      var img = document.createElement("img");
      img.alt = String(v);
      img.src = variantUrl(c, selectedSlug, v);
      b.appendChild(img);
      var lab = document.createElement("span");
      lab.textContent = String(v);
      b.appendChild(lab);
      b.addEventListener("click", function () {
        selectedVariant = v;
        selectChamp(c.id, true);
      });
      hold.appendChild(b);
    });
  }

  function intIndex(n) {
    n = parseInt(n, 10);
    return isNaN(n) ? 0 : n;
  }

  function nextSkinIndex(c) {
    var max = -1;
    (c.skins || []).forEach(function (s) {
      var n = intIndex(s.index);
      if (n > max) max = n;
    });
    return max + 1;
  }

  function renderAnims(c) {
    var hold = $("lc-anims");
    if (!hold) return;
    hold.innerHTML = "";
    (c.animations || []).forEach(function (a) {
      var v = document.createElement("video");
      v.src = a.file;
      v.controls = true;
      v.loop = true;
      v.muted = true;
      v.playsInline = true;
      v.title = a.action + " " + a.index;
      hold.appendChild(v);
    });
  }

  function selectChamp(id, keepSkin) {
    selectedId = id;
    var c = champById(id);
    if (!c) return;
    var ds = displaySkins(c);
    if (!keepSkin || !selectedSlug) {
      selectedSlug = ds[0] ? ds[0].slug : "";
      selectedVariant = 0;
    }
    var skinRow = skinBySlug(c, selectedSlug) || ds[0];
    if (skinRow) selectedSlug = skinRow.slug || skinRow.folder;
    if ($("lc-name")) $("lc-name").textContent = c.name;
    if ($("lc-title")) $("lc-title").textContent = c.title;
    if ($("lc-roles")) $("lc-roles").textContent = (c.roles || []).join(" · ");
    var nextV = skinRow && skinRow.variant_count ? skinRow.variant_count : 0;
    if ($("lc-idline")) {
      $("lc-idline").textContent =
        c.id +
        " · skin " +
        (skinRow && skinRow.ord ? skinRow.ord : "?") +
        "/" +
        ds.length +
        " · " +
        (skinRow && skinRow.name ? skinRow.name : "") +
        " · folder …/" +
        (skinRow && skinRow.folder ? skinRow.folder : "") +
        "/" +
        selectedVariant +
        ".jpg · next " +
        nextV +
        ".jpg";
    }
    var hero = $("lc-hero");
    if (hero) hero.src = variantUrl(c, selectedSlug, selectedVariant) || c.splash || c.icon;
    var look = (skinRow && skinRow.look) || c.look || {};
    if ($("lc-desc")) $("lc-desc").textContent = look.description || "";
    if ($("lc-prompt")) $("lc-prompt").value = look.prompt || "";
    if ($("lc-site")) {
      $("lc-site").textContent =
        c.name + ", " + c.title + ". " + (c.blurb || "") + (c.lore ? "\n\n" + c.lore : "");
    }
    if ($("lc-lore")) $("lc-lore").textContent = c.lore || c.blurb || "";
    var sp = $("lc-spells");
    if (sp) {
      sp.innerHTML = "";
      (c.spells || []).forEach(function (s) {
        var p = document.createElement("p");
        p.innerHTML = "";
        p.textContent = (s.key || "") + "  " + (s.name || "") + " — " + (s.description || "");
        sp.appendChild(p);
      });
    }
    renderSkinStrip(c);
    renderVariants(c);
    renderAnims(c);
    renderGrid();
    var detail = $("lc-detail");
    if (detail) detail.hidden = false;
    detail && detail.classList.add("has-champ");
  }

  function loadRoster() {
    return fetch(apiUrl("/api/lol-champions"), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        roster = (d && d.champions) || [];
        renderGrid();
        if (selectedId && champById(selectedId)) selectChamp(selectedId, true);
        var pull = d && d.pull;
        var extra = "";
        if (pull && pull.busy) extra = " · pulling skins " + (pull.done || 0) + "/" + (pull.total || "?");
        setStatus(roster.length + " champions · patch " + ((d && d.version) || "") + extra);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Failed to load roster");
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
    var other = 0;
    order.forEach(function (n) {
      if (n >= 1 && n <= 1000) paintings += 1;
      else if (n >= 100000 && n < 200000) generated += 1;
      else other += 1;
    });
    return { paintings: paintings, generated: generated, other: other, total: order.length };
  }

  function bookCountNote() {
    var b = arsenalBreakdown();
    if (spellSource === "paintings") return "";
    if (spellSource === "generated") return " · generated extras";
    return " · " + b.paintings + " paintings + " + b.generated + " generated";
  }

  function updateSourceLabels() {
    var sel = $("lc-spell-source");
    if (!sel) return;
    var b = arsenalBreakdown();
    var opts = sel.options;
    var i;
    for (i = 0; i < opts.length; i++) {
      if (opts[i].value === "paintings") {
        opts[i].textContent = "Paintings · " + b.paintings;
      } else if (opts[i].value === "generated") {
        opts[i].textContent = "Generated · " + b.generated;
      } else if (opts[i].value === "all") {
        opts[i].textContent = "All arsenal · " + b.total;
      }
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
    var hold = $("lc-spell-slots");
    if (!hold) return;
    hold.innerHTML = "";
    blendSpells.forEach(function (n, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lc-spell-slot" + (armedSlot === i ? " armed" : "");
      b.title = n
        ? "Spell " + SLOT_LABELS[i] + " #" + n + " — click to arm, click again to clear"
        : "Spell " + SLOT_LABELS[i] + " — click, then pick a painting";
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
      if (target < 0) target = blendSpells.indexOf(undefined);
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
    var hold = $("lc-spell-tray");
    if (!hold) return;
    var order = bookList();
    var pages = Math.max(1, Math.ceil(order.length / SPELL_PAGE));
    if (spellPage >= pages) spellPage = pages - 1;
    if (spellPage < 0) spellPage = 0;
    var prev = $("lc-spell-prev");
    var next = $("lc-spell-next");
    if (prev) prev.disabled = spellPage <= 0;
    if (next) next.disabled = spellPage >= pages - 1;
    if ($("lc-spell-page")) {
      $("lc-spell-page").textContent =
        "Page " + (spellPage + 1) + " / " + pages + " · " + order.length + " spells" + bookCountNote();
    }
    updateSourceLabels();
    var jump = $("lc-spell-page-jump");
    if (jump && document.activeElement !== jump) jump.value = String(spellPage + 1);
    var slice = order.slice(spellPage * SPELL_PAGE, spellPage * SPELL_PAGE + SPELL_PAGE);
    hold.innerHTML = "";
    if (!order.length) {
      var empty = document.createElement("p");
      empty.className = "lc-hint";
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
      img.src = paintingUrl(n);
      b.appendChild(img);
      var num = document.createElement("span");
      num.className = "lc-num";
      num.textContent = "#" + n;
      b.appendChild(num);
      b.addEventListener("click", function () {
        placeSpell(n);
      });
      hold.appendChild(b);
    });
  }

  function abilityBlend(c) {
    var parts = [];
    if (c.passive && (c.passive.name || c.passive.description)) {
      parts.push("Passive " + (c.passive.name || "") + ": " + (c.passive.description || ""));
    }
    (c.spells || []).forEach(function (s) {
      parts.push((s.key || "") + " " + (s.name || "") + ": " + (s.description || ""));
    });
    return parts.join(" ");
  }

  function castSkin() {
    var c = champById(selectedId);
    if (!c || busy) return;
    var five = blendSpells.filter(function (n) {
      return parseInt(n, 10) >= 1;
    });
    if (five.length < 5) {
      setStatus("Pick 5 Spellforge spells before casting.");
      return;
    }
    var alter = ($("lc-alter") && $("lc-alter").value) || "";
    var look = ($("lc-prompt") && $("lc-prompt").value) || (c.look && c.look.prompt) || "";
    var skinRow = skinBySlug(c, selectedSlug);
    var prompt = (
      "Logan Sevin Spellforge fusion splash of League champion " +
      c.name +
      ", " +
      c.title +
      (skinRow && skinRow.name ? ", skin " + skinRow.name : "") +
      ". Keep this champion's identity. " +
      "Blend their kit into the vision — " +
      abilityBlend(c) +
      " Spellforge DNA from paintings " +
      five.join(", ") +
      ". " +
      (look ? look + " " : "") +
      (alter ? "Studio alteration: " + alter + ". " : "") +
      "Painterly original gallery still, full figure, dramatic light, no UI, no watermark."
    ).slice(0, 4000);
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "champ-" + Date.now();
    setBusy(true, "image", "Casting " + c.name + " with 5 spells…");
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        fused_prompt: prompt,
        buzz_words: ["champion splash", "full figure", "painterly", "spellforge", c.name],
        spells: five,
        aspect_ratio: "3:4",
        mag_fresh: true,
        fresh_variation: true,
        spell_cast: false,
        source: "lol-champion",
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
        var hero = $("lc-hero");
        if (hero && url) hero.src = url;
        return fetch(apiUrl("/api/lol-champions/" + encodeURIComponent(c.id) + "/save"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: url, alter: alter, skin: selectedSlug }),
        }).then(function (r) {
          return r.json();
        });
      })
      .then(function (d) {
        if (!d || d.ok === false) throw new Error((d && d.error) || "Save failed");
        var saved = (d.skin && (d.skin.variant_file || d.skin.file)) || "";
        setStatus("Saved " + (saved || (c.id + " / " + selectedSlug)));
        return loadRoster();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Cast failed");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function describeChamp() {
    var c = champById(selectedId);
    if (!c || busy) return;
    setBusy(true, "describe", "Transfer-reading " + c.name + " / " + (selectedSlug || "skin") + "…");
    fetch(apiUrl("/api/lol-champions/" + encodeURIComponent(c.id) + "/describe"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skin: selectedSlug }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || d.ok === false) throw new Error((d && d.error) || "Describe failed");
        if (c) c.look = d.look;
        if ($("lc-desc")) $("lc-desc").textContent = (d.look && d.look.description) || "";
        if ($("lc-prompt")) $("lc-prompt").value = (d.look && d.look.prompt) || "";
        setStatus("Look saved for " + c.name + " / " + (selectedSlug || "skin"));
        return loadRoster();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Describe failed");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function animateChamp() {
    var c = champById(selectedId);
    if (!c || busy) return;
    if (!displaySkins(c).length) {
      setStatus("Need a skin still first — pull official skins or Cast one.");
      return;
    }
    var action = ($("lc-anim-action") && $("lc-anim-action").value) || "idle";
    var custom = ($("lc-anim-custom") && $("lc-anim-custom").value) || "";
    custom = String(custom).trim();
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
    var duration = parseInt($("lc-anim-duration") && $("lc-anim-duration").value, 10);
    if ([6, 10, 15].indexOf(duration) < 0) duration = 10;
    var aspect = ($("lc-anim-aspect") && $("lc-anim-aspect").value) || "3:4";
    var still = absUrl(variantUrl(c, selectedSlug, selectedVariant));
    var prompt = (
      "ANIMATE this League champion, " +
      c.name +
      " " +
      c.title +
      ". Motion: " +
      motion +
      ". Single continuous performance of that action, versatile body language, keep identity, painterly Logan Sevin gallery, living figure, no UI. " +
      ((c.look && c.look.prompt) || "")
    ).slice(0, 2000);
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "champ-anim-" + Date.now();
    setBusy(true, "video", "Animating " + c.name + " · " + motion + " · " + duration + "s · " + aspect);
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
        source: "lol-champion",
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
        var vid = $("lc-video");
        if (vid && url) {
          vid.hidden = false;
          vid.src = url;
          vid.classList.add("live");
          vid.play().catch(function () {});
        }
        return fetch(apiUrl("/api/lol-champions/" + encodeURIComponent(c.id) + "/animate-save"), {
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
        return loadRoster();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Animate failed");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function bind() {
    if (document.body.dataset.lcBound) return;
    document.body.dataset.lcBound = "1";
    $("lc-search") &&
      $("lc-search").addEventListener("input", function () {
        query = $("lc-search").value || "";
        renderGrid();
      });
    $("lc-role") &&
      $("lc-role").addEventListener("change", function () {
        role = $("lc-role").value || "all";
        renderGrid();
      });
    $("lc-cast") && $("lc-cast").addEventListener("click", castSkin);
    $("lc-spell-prev") &&
      $("lc-spell-prev").addEventListener("click", function () {
        spellPage -= 1;
        renderSpellTray();
      });
    $("lc-spell-next") &&
      $("lc-spell-next").addEventListener("click", function () {
        spellPage += 1;
        renderSpellTray();
      });
    $("lc-spell-page-jump") &&
      $("lc-spell-page-jump").addEventListener("change", function () {
        var n = parseInt($("lc-spell-page-jump").value, 10);
        if (n >= 1) spellPage = n - 1;
        renderSpellTray();
      });
    $("lc-spell-search") &&
      $("lc-spell-search").addEventListener("input", function () {
        spellQuery = $("lc-spell-search").value || "";
        spellPage = 0;
        renderSpellTray();
      });
    $("lc-spell-jump") &&
      $("lc-spell-jump").addEventListener("change", function () {
        var num = parseInt($("lc-spell-jump").value, 10);
        var order = bookList();
        var idx = order.indexOf(num);
        if (idx < 0) return;
        spellPage = Math.floor(idx / SPELL_PAGE);
        renderSpellTray();
      });
    $("lc-describe") && $("lc-describe").addEventListener("click", describeChamp);
    $("lc-animate") && $("lc-animate").addEventListener("click", animateChamp);
    $("lc-sync") &&
      $("lc-sync").addEventListener("click", function () {
        setStatus("Syncing League roster…");
        fetch(apiUrl("/api/lol-champions/sync"), { method: "POST" })
          .then(function () {
            return delay(2000).then(loadRoster);
          })
          .catch(function (err) {
            setStatus((err && err.message) || "Sync failed");
          });
      });
    $("lc-pull-skins") &&
      $("lc-pull-skins").addEventListener("click", function () {
        setStatus("Pulling official League splashes…");
        fetch(apiUrl("/api/lol-champions/pull-skins"), { method: "POST" })
          .then(function () {
            var n = 0;
            function tick() {
              return loadRoster().then(function () {
                n += 1;
                if (n > 80) return;
                setTimeout(tick, 2500);
              });
            }
            setTimeout(tick, 1500);
          })
          .catch(function (err) {
            setStatus((err && err.message) || "Pull failed");
          });
      });
    function bootBook() {
      fillBlendFromEquipped();
      renderSpellSlots();
      renderSpellTray();
    }
    window.addEventListener("champions-show", function () {
      loadRoster();
      if (window.SpellforgeAPI && window.SpellforgeAPI.whenReady) {
        window.SpellforgeAPI.whenReady().then(bootBook);
      } else {
        bootBook();
      }
    });
    window.addEventListener("spellforge-ready", bootBook);
    $("lc-spell-source") &&
      $("lc-spell-source").addEventListener("change", function () {
        spellSource = $("lc-spell-source").value || "paintings";
        spellPage = 0;
        renderSpellTray();
      });
  }

  function init() {
    if (!$("panel-champions")) return;
    bind();
    fillBlendFromEquipped();
    renderSpellSlots();
    renderSpellTray();
    if (location.hash.replace("#", "") === "champions") loadRoster();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.LolChampions = { onShow: loadRoster };
})();
