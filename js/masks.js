/**
 * Masks — cinematic full-face drama masks (not medical).
 * Expression is mundane/readable; spell detail is explicit on the mask —
 * casting comes FROM the mask surface.
 */
(function () {
  "use strict";

  var TRAY_SIZE = 48;
  var ANALYSES_URL = "data/analyses.json";
  var DEFAULT_POTENCY = 75;
  var MAX_EQUIPPED = 6;

  var state = {
    imageUrl: "",
    busy: false,
    saved: [],
    genNum: null,
    pool: [],
    tray: [],
    equipped: [],
    poolReady: false,
    trayFilter: "all",
    analyses: null,
    analysesLoading: null,
    lod1Analyses: {},
    lastCast: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
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

  function paintingUrl(n) {
    if (typeof window.getPaintingUrl === "function") return window.getPaintingUrl(n);
    return "paintings/" + n + ".jpg";
  }

  function generatedUrl(n) {
    return "/generated/" + n + ".jpg";
  }

  function spellKey(item) {
    if (!item) return "";
    return String(item.kind || "painting") + ":" + String(item.num);
  }

  function clampPotency(v) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return DEFAULT_POTENCY;
    return Math.max(0, Math.min(100, n));
  }

  function potencyWord(p) {
    if (p >= 85) return "DOMINANT";
    if (p >= 65) return "STRONG";
    if (p >= 40) return "MODERATE";
    if (p >= 15) return "LIGHT";
    return "TRACE";
  }

  function setStatus(msg, kind) {
    var el = $("msk-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className =
      "msk-status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  }

  function setBusy(on) {
    state.busy = !!on;
    ["msk-generate", "msk-variation", "msk-save", "msk-randomize"].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      if (id === "msk-save") b.disabled = !!on || !state.imageUrl;
      else b.disabled = !!on;
    });
  }

  function userIdea() {
    var el = $("msk-prompt");
    return el ? String(el.value || "").trim() : "";
  }

  function maskMaterial() {
    var s = $("msk-material");
    return (s && s.value) || "porcelain";
  }

  function maskExpression() {
    var s = $("msk-expression");
    return (s && s.value) || "blank";
  }

  function aspectValue() {
    var s = $("msk-aspect");
    return (s && s.value) || "1:1";
  }

  function backgroundMode() {
    var s = $("msk-background");
    return (s && s.value) || "studio";
  }

  function finishMode() {
    var s = $("msk-finish");
    return (s && s.value) || "matte";
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
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

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureAnalyses() {
    if (state.analyses) return Promise.resolve(state.analyses);
    if (state.analysesLoading) return state.analysesLoading;
    state.analysesLoading = fetch(ANALYSES_URL, { cache: "force-cache" })
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (data) {
        state.analyses = data && typeof data === "object" ? data : {};
        state.analysesLoading = null;
        return state.analyses;
      })
      .catch(function () {
        state.analyses = {};
        state.analysesLoading = null;
        return state.analyses;
      });
    return state.analysesLoading;
  }

  function analysisForPainting(num) {
    var map = state.analyses || {};
    return map[String(num)] || map[num] || null;
  }

  function analysisForGenerated(num) {
    return state.lod1Analyses[String(num)] || state.lod1Analyses[num] || null;
  }

  function ensureGeneratedAnalysis(num) {
    if (analysisForGenerated(num)) return Promise.resolve(analysisForGenerated(num));
    return fetch("generated-meta/" + num + ".json", { cache: "force-cache" })
      .then(function (r) {
        if (r.ok) return r.json();
        return fetch("/generated-meta/" + num + ".json", { cache: "force-cache" }).then(
          function (r2) {
            if (r2.ok) return r2.json();
            // Legacy co-located sidecars (pre generated-meta/)
            return fetch("generated/" + num + ".json", { cache: "force-cache" }).then(
              function (r3) {
                if (r3.ok) return r3.json();
                return fetch("/generated/" + num + ".json", { cache: "force-cache" }).then(
                  function (r4) {
                    return r4.ok ? r4.json() : null;
                  }
                );
              }
            );
          }
        );
      })
      .then(function (data) {
        var a = data && (data.analysis || data);
        if (a && (a.description || a.title || a.prompt)) {
          state.lod1Analyses[String(num)] = a;
          state.lod1Analyses[num] = a;
          return a;
        }
        return null;
      })
      .catch(function () {
        return null;
      });
  }

  function hydrateEquippedAnalyses() {
    return ensureAnalyses().then(function () {
      return Promise.all(
        state.equipped.map(function (item) {
          if (item.kind === "generated") return ensureGeneratedAnalysis(item.num);
          return Promise.resolve();
        })
      );
    });
  }

  function spellDnaFromItem(item) {
    if (!item) return null;
    var kind = item.kind || "painting";
    var num = item.num;
    var pot = clampPotency(item.potency != null ? item.potency : DEFAULT_POTENCY);
    var a =
      kind === "generated" ? analysisForGenerated(num) || {} : analysisForPainting(num) || {};
    var desc = String(a.description || a.prompt || "").replace(/\s+/g, " ").trim();
    var sentences = desc
      ? desc
          .split(/[.!?]+/)
          .map(function (s) {
            return s.trim();
          })
          .filter(function (s) {
            return s.length > 12;
          })
      : [];
    var fragBudget = pot >= 85 ? 240 : pot >= 65 ? 180 : pot >= 40 ? 120 : 70;
    var fragment = "";
    if (sentences.length) {
      var take = pot >= 70 ? Math.min(2, sentences.length) : 1;
      fragment = shuffle(sentences).slice(0, take).join(" ").slice(0, fragBudget);
    } else if (desc) {
      fragment = desc.slice(0, fragBudget);
    }
    return {
      key: spellKey(item),
      kind: kind,
      num: num,
      label: item.label || (kind === "generated" ? "G#" + num : "#" + num),
      potency: pot,
      title: String(a.title || "").slice(0, 48),
      mood: String(a.mood || "").slice(0, 40),
      style: String(a.style || "").slice(0, 40),
      tags: shuffle(a.tags || []).slice(0, pot >= 70 ? 5 : 3),
      colors: shuffle(a.colors || []).slice(0, pot >= 70 ? 5 : 3),
      fragment: fragment,
    };
  }

  function dnaWhisper(chip) {
    var bits = [];
    if (chip.colors && chip.colors.length) bits.push(chip.colors.slice(0, 4).join(", "));
    if (chip.mood) bits.push(chip.mood);
    if (chip.style) bits.push(chip.style);
    if (chip.tags && chip.tags.length) bits.push(chip.tags.join(", "));
    if (chip.fragment) bits.push(chip.fragment);
    return bits.join(" · ") || "quiet atmospheric force";
  }

  function equippedDnaChips() {
    return state.equipped
      .map(spellDnaFromItem)
      .filter(Boolean)
      .sort(function (a, b) {
        return b.potency - a.potency;
      });
  }

  function expressionLine() {
    return (
      {
        blank: "blank, still face — open calm eyes, mouth closed, no performance grin",
        slight: "slight soft smile — small, everyday, not theatrical rictus",
        excited: "excited — brighter open eyes, brows lifted a little, small eager smile; everyday enthusiasm, not cartoon glee",
        tired: "tired eyes, mild heavy lids, neutral mouth — mundane fatigue",
        focus: "quiet focused gaze, brows almost level, soft concentration",
        softfrown: "very slight frown — mild concern, not melodrama",
        curious: "mild curiosity — eyes a touch wider, mouth neutral",
        solemn: "solemn plain face — dignified, unadorned emotion",
        sleepy: "half-lidded sleepy calm — peaceful, not comic",
        worried: "worried — brows drawn a little inward, eyes tense, mouth soft and tight; everyday anxiety, not tragedy mask",
        infatuated: "infatuated — soft unfocused warmth in the eyes, slight parted lips or tiny private smile; crush energy, not melodrama",
        grievanced: "grieved / grievanced — heavy quiet sorrow, downturned mouth, eyes dull with held pain; plain human grief, not operatic wailing",
        anxious: "anxious — restless eyes, tight jaw, subtle crease between brows; waiting-room nerves",
        wistful: "wistful — faraway gaze, soft half-smile that never fully arrives",
        annoyed: "mildly annoyed — slight brow pinch, flat mouth; everyday irritation, not rage",
        embarrassed: "embarrassed — eyes averted a little, faint flush implied in the mask paint, awkward small mouth",
        hopeful: "hopeful — brows lifted slightly, eyes open and soft, mouth almost smiling",
        skeptical: "skeptical — one brow a touch higher, mouth set sideways; polite doubt",
        bored: "bored — heavy lids, slack mouth, disengaged stare; waiting-room boredom",
        startled: "lightly startled — eyes a bit wider, brows raised a notch; surprise without cartoon shock",
        tender: "tender — warm soft eyes, gentle mouth curve; quiet care, not romance-cover excess",
        bitter: "quiet bitter — mouth set, eyes cool and tired of it; contained resentment",
        relieved: "relieved — exhale in the face, brows eased, soft open mouth almost smiling",
        shy: "shy — eyes cast slightly down or aside, small tight smile, reserved",
        yearning: "yearning — eyes fixed on something far, lips parted slightly with want, restrained",
        pensive: "pensive — thoughtful still face, gaze inward, neutral mouth",
        smug: "slight smug — tiny asymmetric smile, confident calm eyes; everyday self-satisfaction",
        hurt: "quietly hurt — soft pain in the eyes, mouth pressed thin; not crying-out",
        grateful: "soft grateful — gentle open expression, warm eyes, small sincere smile",
        defiant: "quiet defiant — steady forward gaze, jaw set lightly; stubborn without shouting",
        lonely: "lonely — empty-room eyes, soft downturn, still face that wants company",
      }[maskExpression()] || "mundane readable expression"
    );
  }

  function materialLine() {
    return (
      {
        porcelain: "fine porcelain / ceramic drama mask, glaze and hairline crackle",
        leather: "full-face tooled leather mask, stitched seams, worn grain",
        metal: "hammered metal full-face mask, seams and soft polish",
        wood: "carved wood full-face mask, grain and paint wear",
        resin: "cinema resin/plastic prop mask, matte paint, production finish",
        paper: "layered papier-mâché / paper-pulp full mask, fiber edges",
        bone: "smooth bone-ivory full mask, polished planes (not gore)",
        glass: "frosted glass / translucent enamel full mask",
      }[maskMaterial()] || "cinematic full-face drama mask"
    );
  }

  function finishLine() {
    return (
      {
        matte: "MATTE / painted finish — soft diffuse surface, little specular glare",
        gloss: "GLOSS / glazed finish — wet sheen, soft highlights, lacquered planes",
        reflective:
          "REFLECTIVE finish — polished mirror-like planes on the mask; clear speculars; " +
          "environment and spell-world colors catch on cheeks, brow, and jaw as real reflections " +
          "(not pasted stickers). Keep expression readable through the reflections.",
        mirror:
          "MIRROR / CHROME finish — highly reflective full-face drama mask; sharp environment " +
          "reflections wrap the form; spell-background world may appear distorted on the surface; " +
          "face planes still read as a mask with mundane expression.",
      }[finishMode()] || "matte finish"
    );
  }

  function spellMaskSurface(chips) {
    if (!chips.length) {
      return "SPELL SURFACE: invent explicit surface detail; no spells equipped.\n";
    }
    var lines = [
      "SPELL SURFACE LANGUAGE (casting comes FROM the mask — honor potency %):",
      "Each spell paints the mask itself: pigments, inlays, textures, motifs, edge trim, eye-slot accents.",
      "Expression stays mundane; the MAGIC is the surface detail of the spells.",
    ];
    chips.forEach(function (c) {
      var src = c.kind === "generated" ? "generated G#" + c.num : "painting #" + c.num;
      lines.push(
        "· " +
          c.label +
          " (" +
          src +
          ") @" +
          c.potency +
          "% " +
          potencyWord(c.potency) +
          (c.title ? " “" + c.title + "”" : "") +
          " → mask surface / casting detail: " +
          dnaWhisper(c) +
          (c.potency >= 65
            ? " — dominate forehead, cheeks, and brow planes."
            : c.potency >= 30
              ? " — clear secondary motif on cheek or jaw."
              : " — faint edge accent only.")
      );
    });
    return lines.join("\n") + "\n";
  }

  function spellBackgroundBlock(chips) {
    var mode = backgroundMode();
    if (mode === "studio") {
      return (
        "BACKGROUND: simple dark or soft studio ground — neutral, out of focus. " +
        "Spells live on the mask surface (and reflections if reflective), not as a full world behind.\n"
      );
    }
    if (!chips.length) {
      return (
        "BACKGROUND: spell-world mode, but no spells equipped — invent a rich atmospheric backdrop " +
        "that supports the mask without cluttering the face.\n"
      );
    }
    var ranked = chips.slice().sort(function (a, b) {
      return b.potency - a.potency;
    });
    var lines = [
      "BACKGROUND — SPELL WORLD (mandatory; behind the mask):",
      mode === "spells-soft"
        ? "Soft atmospheric spell world: color fields, fog, light, and motifs from spells — blurred depth of field so the mask stays primary."
        : mode === "spells-stage"
          ? "Spell stage / set: a readable environment or stage space built from spell DNA (architecture, weather, props) — still secondary to the mask."
          : "Full spell world behind the head: landscape/interior/mood from spell DNA fills the background; mask remains the clear subject.",
      "Transform spell information into background — do NOT paste source images as flat panels.",
    ];
    ranked.forEach(function (c, i) {
      var role =
        i === 0
          ? "primary background world / palette / setting"
          : i === 1
            ? "secondary atmosphere / mid-ground motif"
            : "accent light / color / weather";
      lines.push(
        "· " +
          c.label +
          " @" +
          c.potency +
          "% " +
          potencyWord(c.potency) +
          " → " +
          role +
          ": " +
          dnaWhisper(c).slice(0, c.potency >= 60 ? 160 : 100)
      );
    });
    if (finishMode() === "reflective" || finishMode() === "mirror") {
      lines.push(
        "Because the mask is reflective, the same spell-world should also appear as curved reflections on the mask planes " +
          "(distorted, luminous) — background and reflection agree."
      );
    }
    return lines.join("\n") + "\n";
  }

  function buildMaskPrompt(options) {
    options = options || {};
    var chips = equippedDnaChips();
    var idea = userIdea();
    var mat = materialLine();
    var expr = expressionLine();
    var finish = finishLine();
    var bgMode = backgroundMode();
    var fin = finishMode();
    var seed =
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10)) +
      "-" +
      Date.now().toString(36);
    var title =
      "Mask · " +
      maskMaterial() +
      " · " +
      maskExpression() +
      (fin === "reflective" || fin === "mirror" ? " · " + fin : "") +
      (bgMode !== "studio" ? " · bg" : "") +
      " · " +
      seed.slice(0, 6);

    var lead =
      chips[0] && chips[0].potency >= 20
        ? "Lead casting force " +
          chips[0].label +
          " @" +
          chips[0].potency +
          "%: " +
          dnaWhisper(chips[0]).slice(0, 180)
        : "Invent original surface casting detail.";

    var prompt = (
      "CREATE ONE BRAND-NEW full-bleed fine-art painting of a CINEMATIC FULL-FACE DRAMA MASK.\n\n" +
      "CRITICAL — MASK TYPE:\n" +
      "- Theater / carnival / cinema DRAMA MASK covering the ENTIRE face (forehead to chin). " +
      "NOT medical/surgical/COVID, NOT mouth-only half-mask, NOT ski mask, NOT helmet.\n" +
      "- Base material: " +
      mat +
      ".\n" +
      "- Surface finish: " +
      finish +
      "\n\n" +
      "EXPRESSION (mundane, explicit, readable — not melodrama):\n" +
      expr +
      ".\n" +
      "Ordinary human micro-expression sculpted into the mask.\n\n" +
      "CASTING FROM THE MASK (PRIMARY — surface):\n" +
      "Spell detail is EXPLICIT on the mask — as if the spell is cast FROM the mask. " +
      "Motifs, colors, textures of equipped spells ARE decoration, inlays, paint, edge language. " +
      "Transform spell DNA — do NOT paste source paintings as stickers.\n" +
      lead +
      "\n\n" +
      spellMaskSurface(chips) +
      "\n" +
      spellBackgroundBlock(chips) +
      "\n" +
      (idea
        ? "User note (blend into mask + background craft, not as text): “" +
          idea.slice(0, 160) +
          "”.\n\n"
        : "") +
      "FRAMING: portrait or bust of a head wearing the mask — centered, museum-quality lighting. " +
      "Single coherent still. No HUD, watermark, readable text, collage panels, or medical PPE.\n" +
      "SEED: " +
      seed +
      " · TITLE: " +
      title +
      (options.variationNote ? "\n" + options.variationNote : "")
    ).slice(0, 4500);

    var buzz = shuffle(
      [
        "full face drama mask",
        "cinematic mask",
        "not medical mask",
        "mundane expression",
        "casting from the mask",
        "spell surface detail",
        fin === "mirror" || fin === "reflective" ? "reflective mask" : "mask finish",
        bgMode !== "studio" ? "spell background" : "studio ground",
        maskMaterial(),
        maskExpression(),
        seed.slice(0, 6),
      ].concat(
        chips.slice(0, 3).map(function (c) {
          return c.label + " " + c.potency + "%";
        })
      )
    ).slice(0, 14);

    return {
      prompt: prompt,
      title: title,
      seed: seed,
      buzz: buzz,
      subject: lead,
      background: bgMode,
      finish: fin,
      potencies: chips.map(function (c) {
        return { key: c.key, label: c.label, potency: c.potency, kind: c.kind, num: c.num };
      }),
    };
  }

  function showPreview(url) {
    state.imageUrl = url || "";
    var img = $("msk-preview");
    var empty = $("msk-empty");
    if (img) {
      if (url) {
        img.src = absUrl(url);
        img.hidden = false;
      } else {
        img.removeAttribute("src");
        img.hidden = true;
      }
    }
    if (empty) empty.hidden = !!url;
    var save = $("msk-save");
    if (save) save.disabled = state.busy || !url;
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

  function pollJob(jobId, left, statusLabel) {
    if (left == null) left = 90;
    var label = statusLabel || "Casting mask";
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for mask image."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        var st = String(job.status || "working").toLowerCase();
        setStatus(label + "… " + st);
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job done but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Generate failed");
        }
        return delay(1500).then(function () {
          return pollJob(jobId, left - 1, label);
        });
      });
  }

  function newJobId(prefix) {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : (prefix || "mask") + "-" + Date.now();
  }

  function runGenerate(cast) {
    var jobId = newJobId("mask");
    var body = {
      job_id: jobId,
      stasis: cast.prompt.slice(0, 4200),
      prompt: cast.prompt.slice(0, 4200),
      fused_prompt: cast.prompt.slice(0, 4200),
      buzz_words: cast.buzz,
      spells: [],
      spell_details: [],
      aspect_ratio: aspectValue(),
      mag_fresh: true,
      fresh_variation: true,
      refine: false,
      spell_cast: false,
      source: "masks-tab",
      craft_hints:
        "Full-face cinematic drama mask only (not medical). Mundane expression. " +
        "Spell detail on mask surface" +
        (cast.background && cast.background !== "studio"
          ? " + spell-driven background"
          : "") +
        (cast.finish === "reflective" || cast.finish === "mirror"
          ? "; reflective/mirror finish with real reflections"
          : "") +
        ". Seed " +
        cast.seed,
    };
    setStatus("Casting mask…");
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
        if (res.status === 202 || (!extractImageUrl(d) && (d.job_id || jobId))) {
          return pollJob(d.job_id || jobId, 90, "Casting mask");
        }
        if (!res.ok) throw new Error((d && d.error) || "Generate failed");
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollJob(d.job_id, 90, "Casting mask");
        if (!url) throw new Error("No image returned");
        return url;
      });
  }

  function generateMask(isVariation) {
    if (state.busy) return;
    if (!state.equipped.length && !userIdea()) {
      setStatus("Equip spells (or describe the mask), then cast.", "err");
      return;
    }
    setBusy(true);
    setStatus("Reading spell DNA for mask surface…");
    hydrateEquippedAnalyses()
      .then(function () {
        var cast = buildMaskPrompt(
          isVariation
            ? {
                variationNote:
                  "VARIATION: new mask arrangement and surface layout; keep full-face drama type and mundane expression; new spell surface weave.",
              }
            : {}
        );
        state.lastCast = cast;
        var nameEl = $("msk-name");
        if (nameEl && !String(nameEl.value || "").trim()) nameEl.value = cast.title;
        return runGenerate(cast).then(function (url) {
          state.genNum = null;
          showPreview(url);
          var pots = (cast.potencies || [])
            .map(function (p) {
              return p.label + " " + p.potency + "%";
            })
            .join(", ");
          setStatus(
            "Mask ready" + (pots ? " · " + pots : "") + ". Immerse via preview or Save.",
            "ok"
          );
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Generate failed", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function equippedSpellMeta() {
    return state.equipped.map(function (s) {
      return {
        kind: s.kind || "painting",
        num: s.num,
        label: s.label,
        potency: clampPotency(s.potency),
        url: s.url,
      };
    });
  }

  function saveMask() {
    if (!state.imageUrl || state.busy) return;
    var nameEl = $("msk-name");
    var name = nameEl ? String(nameEl.value || "").trim() : "";
    if (!name) {
      name = (state.lastCast && state.lastCast.title) || "Drama mask";
      if (nameEl) nameEl.value = name;
    }
    var castPrompt = (state.lastCast && state.lastCast.prompt) || userIdea() || "";
    setBusy(true);
    setStatus("Saving mask…");
    fetch(apiUrl("/api/save-generated-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: state.imageUrl,
        source: "masks",
        collection: "generated",
        description: (name + " · full-face drama mask").slice(0, 240),
        meta: {
          source: "masks",
          material: maskMaterial(),
          expression: maskExpression(),
          background: backgroundMode(),
          finish: finishMode(),
          prompt: userIdea(),
          cast_prompt: String(castPrompt).slice(0, 1200),
          spells: equippedSpellMeta(),
        },
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "Save generated failed");
          }
          return d;
        });
      })
      .then(function (saved) {
        state.genNum = saved && saved.num != null ? saved.num : null;
        var url = (saved && saved.url) || state.imageUrl;
        return fetch(apiUrl("/api/masks"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name,
            material: maskMaterial(),
            expression: maskExpression(),
            background: backgroundMode(),
            finish: finishMode(),
            prompt: userIdea(),
            cast_prompt: String(castPrompt).slice(0, 1200),
            image_url: url,
            gen_num: state.genNum,
            spells: equippedSpellMeta(),
          }),
        }).then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || (d && d.ok === false)) {
              throw new Error((d && d.error) || "Mask catalog save failed");
            }
            return d;
          });
        });
      })
      .then(function () {
        setStatus(
          "Saved “" + name + "”" + (state.genNum != null ? " · G#" + state.genNum : "") + ".",
          "ok"
        );
        return loadSaved();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Save failed", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function loadSaved() {
    return fetch(apiUrl("/api/masks"), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        state.saved = (d && d.masks) || [];
        renderSaved();
      })
      .catch(function () {
        state.saved = [];
        renderSaved();
      });
  }

  function renderSaved() {
    var list = $("msk-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state.saved.length) {
      list.innerHTML = '<p class="msk-empty-list">No saved masks yet.</p>';
      return;
    }
    state.saved
      .slice()
      .reverse()
      .forEach(function (m) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "msk-card";
        var url = absUrl(m.image_url || m.url || "");
        btn.innerHTML =
          (url ? '<img src="' + url.replace(/"/g, "") + '" alt="" loading="lazy" />' : "") +
          "<span>" +
          escapeHtml(m.name || "Mask") +
          "<small>" +
          escapeHtml(
            (m.material || "mask") +
              (m.expression ? " · " + m.expression : "") +
              (m.gen_num != null ? " · G#" + m.gen_num : "")
          ) +
          "</small></span>";
        btn.addEventListener("click", function () {
          if (url) showPreview(url);
          var n = $("msk-name");
          if (n) n.value = m.name || "";
          var p = $("msk-prompt");
          if (p && m.prompt) p.value = m.prompt;
          setStatus("Loaded “" + (m.name || "mask") + "”.");
        });
        list.appendChild(btn);
      });
  }

  /* —— Tray —— */
  function loadSpellPool() {
    if (state.poolReady && state.pool.length) {
      if (!state.tray.length) fillTray();
      renderTray();
      renderEquipped();
      return;
    }
    setStatus("Loading paintings + generated…");
    var paintings = [];
    for (var i = 1; i <= 1000; i++) {
      paintings.push({
        kind: "painting",
        num: i,
        url: paintingUrl(i),
        label: "#" + i,
      });
    }
    fetch(apiUrl("/api/dream-pool"), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        var gens = [];
        ((d && d.generated_nums) || []).forEach(function (n) {
          n = parseInt(n, 10);
          if (!n) return;
          gens.push({
            kind: "generated",
            num: n,
            url: generatedUrl(n),
            label: "G#" + n,
          });
        });
        state.pool = paintings.concat(gens);
        state.poolReady = true;
        fillTray();
        renderTray();
        renderEquipped();
        setStatus(
          "Tray ready — " + paintings.length + " paintings + " + gens.length + " generated.",
          "ok"
        );
      })
      .catch(function () {
        state.pool = paintings;
        state.poolReady = true;
        fillTray();
        renderTray();
        renderEquipped();
        setStatus("Tray: paintings only (generated pool unavailable).", "err");
      });
  }

  function filteredPool() {
    var f = state.trayFilter || "all";
    if (f === "all") return state.pool.slice();
    return state.pool.filter(function (item) {
      return item.kind === f;
    });
  }

  function fillTray() {
    var copy = filteredPool();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    state.tray = copy.slice(0, TRAY_SIZE);
  }

  function setTrayFilter(filter) {
    state.trayFilter = filter || "all";
    document.querySelectorAll("#panel-masks .msk-filter-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-filter") === state.trayFilter);
    });
    fillTray();
    renderTray();
  }

  function renderTray() {
    var strip = $("msk-spell-strip");
    var count = $("msk-tray-count");
    if (!strip) return;
    strip.innerHTML = "";
    state.tray.forEach(function (item, idx) {
      var el = document.createElement("button");
      el.type = "button";
      el.className =
        "msk-spell" + (item.kind === "generated" ? " is-generated" : " is-painting");
      el.dataset.idx = String(idx);
      el.title = "Equip " + item.label;
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      img.loading = "lazy";
      var lab = document.createElement("span");
      lab.textContent = item.label;
      el.appendChild(img);
      el.appendChild(lab);
      el.addEventListener("click", function () {
        equipSpell(item);
      });
      strip.appendChild(el);
    });
    if (count) {
      count.textContent =
        state.tray.length +
        " shown · " +
        state.equipped.length +
        " equipped";
    }
  }

  function renderEquipped() {
    var box = $("msk-equipped");
    if (!box) return;
    box.innerHTML = "";
    if (!state.equipped.length) {
      box.innerHTML =
        '<span class="msk-equipped-empty">Equip spells — their detail becomes the mask surface (casting from the mask). Set potency.</span>';
      return;
    }
    state.equipped.forEach(function (item, idx) {
      var pot = clampPotency(item.potency != null ? item.potency : DEFAULT_POTENCY);
      item.potency = pot;
      var row = document.createElement("div");
      row.className =
        "msk-equip-row" + (item.kind === "generated" ? " is-generated" : "");
      row.innerHTML =
        '<img class="msk-equip-thumb" src="' +
        String(item.url).replace(/"/g, "") +
        '" alt="" />' +
        '<div class="msk-equip-meta">' +
        '<div class="msk-equip-top">' +
        "<strong>" +
        escapeHtml(item.label) +
        "</strong>" +
        '<span class="msk-equip-kind">' +
        (item.kind === "generated" ? "generated" : "painting") +
        "</span>" +
        '<button type="button" class="msk-equip-remove" data-idx="' +
        idx +
        '">×</button></div>' +
        '<label class="msk-potency-label"><span>Influence <em class="msk-potency-val">' +
        pot +
        "%</em> · " +
        potencyWord(pot) +
        '</span><input type="range" class="msk-potency" min="0" max="100" step="5" value="' +
        pot +
        '" data-idx="' +
        idx +
        '" /></label></div>';
      box.appendChild(row);
    });
    box.querySelectorAll(".msk-equip-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = parseInt(btn.getAttribute("data-idx"), 10);
        var gone = state.equipped[i];
        state.equipped.splice(i, 1);
        renderEquipped();
        renderTray();
        setStatus("Removed " + (gone && gone.label) + ".");
      });
    });
    box.querySelectorAll(".msk-potency").forEach(function (range) {
      range.addEventListener("input", function () {
        var i = parseInt(range.getAttribute("data-idx"), 10);
        var p = clampPotency(range.value);
        if (!state.equipped[i]) return;
        state.equipped[i].potency = p;
        var row = range.closest(".msk-equip-row");
        if (row) {
          var lab = row.querySelector(".msk-potency-label span");
          if (lab) {
            lab.innerHTML =
              'Influence <em class="msk-potency-val">' +
              p +
              "%</em> · " +
              potencyWord(p);
          }
        }
      });
    });
  }

  function equipSpell(item) {
    if (!item || item.num == null) return;
    var key = spellKey(item);
    if (
      state.equipped.some(function (s) {
        return spellKey(s) === key;
      })
    ) {
      setStatus(item.label + " already equipped.", "err");
      return;
    }
    if (state.equipped.length >= MAX_EQUIPPED) {
      setStatus("Max " + MAX_EQUIPPED + " spells.", "err");
      return;
    }
    state.equipped.push({
      kind: item.kind || "painting",
      num: item.num,
      url: item.url,
      label: item.label,
      potency: DEFAULT_POTENCY,
    });
    renderEquipped();
    renderTray();
    if (item.kind === "generated") ensureGeneratedAnalysis(item.num);
    setStatus("Equipped " + item.label + " @ " + DEFAULT_POTENCY + "%.");
  }

  function bindDrag() {
    var strip = $("msk-spell-strip");
    var well = $("msk-well");
    if (!strip || strip.dataset.dragBound) return;
    strip.dataset.dragBound = "1";
    var drag = null;
    strip.addEventListener("pointerdown", function (e) {
      var btn = e.target.closest(".msk-spell");
      if (!btn) return;
      var item = state.tray[parseInt(btn.dataset.idx, 10)];
      if (!item) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      var ghost = document.createElement("div");
      ghost.className = "msk-drag-ghost";
      var img = document.createElement("img");
      img.src = item.url;
      ghost.appendChild(img);
      document.body.appendChild(ghost);
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      drag = { item: item, ghost: ghost, pid: e.pointerId };
      if (well) well.classList.add("msk-drop-active");
    });
    strip.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.pid) return;
      drag.ghost.style.left = e.clientX + "px";
      drag.ghost.style.top = e.clientY + "px";
    });
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var r = well ? well.getBoundingClientRect() : null;
      var over =
        r &&
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
      if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
      if (well) well.classList.remove("msk-drop-active");
      if (over) equipSpell(drag.item);
      drag = null;
    }
    strip.addEventListener("pointerup", endDrag);
    strip.addEventListener("pointercancel", endDrag);
  }

  function bind() {
    var handlers = {
      "msk-generate": function () {
        generateMask(false);
      },
      "msk-variation": function () {
        generateMask(true);
      },
      "msk-save": saveMask,
      "msk-randomize": function () {
        fillTray();
        renderTray();
        setStatus("Shuffled tray.");
      },
      "msk-clear-spells": function () {
        state.equipped = [];
        renderEquipped();
        renderTray();
        setStatus("Cleared spells.");
      },
    };
    Object.keys(handlers).forEach(function (id) {
      var el = $(id);
      if (!el || el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", handlers[id]);
    });
    document.querySelectorAll("#panel-masks .msk-filter-btn").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        setTrayFilter(btn.getAttribute("data-filter") || "all");
      });
    });
    setTrayFilter(state.trayFilter || "all");
    bindDrag();
  }

  function onShow() {
    bind();
    loadSpellPool();
    ensureAnalyses();
    loadSaved();
  }

  function onHide() {}

  window.Masks = { onShow: onShow, onHide: onHide };
  window.addEventListener("masks-show", onShow);
  window.addEventListener("masks-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
