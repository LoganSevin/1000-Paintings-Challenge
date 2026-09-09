/**
 * Demand — ranked Grok-scale asks, filtered to what this gallery can ship.
 * Not xAI private telemetry. Pattern + public product heat, mapped onto this studio.
 */
(function () {
  "use strict";

  var STORAGE = "gallery.demand.stars.v1";

  var ASKS = [
    {
      id: "face-lock",
      heat: 98,
      title: "Same face, every still and clip",
      status: "partial",
      needs: "xai",
      ask: "“Keep her face. New room. New clothes. Same person.” The #1 Imagine / Animate failure people bring Grok.",
      why: "Imagine Video 1.5 shipped named image refs (up to 7) because this broke everyone. Identity drift is the complaint that never dies.",
      site: "Logan + Characters exist. What’s missing is a single Face Board: pin 3–7 refs, name them, and force Animate / Ideal / Movie to send those URLs on every job.",
      tabs: ["Logan", "Characters", "Animate", "Ideal"],
      effort: 3,
      brief:
        "Add a Face Board tab or drawer. Pick 3–7 stills from Characters / Logan / phone-uploads. Name each. Persist in data/. When Animate, Ideal, Movie, or Viral starts a video job, attach reference_image_urls (or the studio equivalent) and inject “keep identity of NAME” into the prompt. Show a drift warning if fewer than 3 refs.",
    },
    {
      id: "still-to-clip",
      heat: 96,
      title: "This still, now moving, and it finishes",
      status: "partial",
      needs: "xai",
      ask: "“Turn this painting into a clip.” Then they wait, the UI lies, or the save drops.",
      why: "Image-to-video is the loudest creative demand after still generation. People will sit through minutes if the job actually comes back.",
      site: "Animate / Ideal / Spellshop already start jobs. Harden: poll until done, save via GallerySaveVideo, never claim success on a socket drop.",
      tabs: ["Animate", "Ideal", "Spell Shop", "Movie"],
      effort: 2,
      brief:
        "One shared job runner for all video tabs: start → poll /api status for up to ~8 min → save file → show the clip in a <video>. Retry proxy fetches. Surface the output path. Do this before adding new generators.",
    },
    {
      id: "inpaint",
      heat: 94,
      title: "Change one thing. Leave the rest.",
      status: "gap",
      needs: "xai",
      ask: "“Only the sky. Only the hand. Don’t touch the face.” Precision edit, not a whole new picture.",
      why: "Grok Imagine Image 2.0 was sold on surgical edits. This is how artists actually work: a mark, not a reroll.",
      site: "No dedicated inpaint tab. Build over a gallery still: brush a mask, type the change, call the image API with mask + source, save to generated/.",
      tabs: ["Gallery", "Prompt", "Ideal", "Spellforge"],
      effort: 4,
      brief:
        "New tab Inpaint next to Demand or under Prompt. Load paintings/generated. Canvas mask (draw white = edit). Prompt = what to put there. POST source + mask to existing xAI image route (or /api/analyze-lod1-style generate). Write generated/N.jpg and a generated-num. Phone finger painting on the mask.",
    },
    {
      id: "talking-still",
      heat: 91,
      title: "The painting speaks",
      status: "partial",
      needs: "xai",
      ask: "Voice. Roleplay. A portrait that answers. 3D companions got retired; the ask did not.",
      why: "Grok Voice / STT is a shipped product line. People want to talk to a character, not a chat box.",
      site: "Ears makes spell sound. Logan locks a face. Missing: press-to-talk on a still, STT → a line in the painting’s voice → optional lip-ish Animate.",
      tabs: ["Ears", "Logan", "Masks", "Dream Stasis"],
      effort: 4,
      brief:
        "Tab Speak or extend Logan: choose a still, hold to talk (MediaRecorder), send audio to xAI STT if present else skip to typed line. Generate a short spoken reply (text + optional TTS). Optionally kick a 2–4s Animate of that still. Keep it LAN/HTTPS for phone mic (same as Transfer camera).",
    },
    {
      id: "dna-new-subject",
      heat: 88,
      title: "My DNA, new subject",
      status: "shipped",
      needs: "xai",
      ask: "“In my style, but a different thing.” Not a copy of painting 47 — the grammar of 47.",
      why: "Every artist-with-a-model wants this. It’s the product Spellforge already is.",
      site: "Spellforge, Conceptualizer, Spells, Brew, Plasma already mix gallery DNA. Don’t rebuild. Point people here; maybe one ‘use this painting as the only parent’ button.",
      tabs: ["Spellforge", "Conceptualizer", "Spells", "Plasma"],
      effort: 1,
      brief:
        "Small: on Gallery and Saccade, an action “Cast as only parent” that opens Spellforge/Conceptualizer with that still locked in the mix. No new generator.",
    },
    {
      id: "place-lock",
      heat: 85,
      title: "Same room, new event",
      status: "partial",
      needs: "xai",
      ask: "“Keep the location. Change who is in it / what happens.” World lock, sibling of face lock.",
      why: "Imagine refs now lock a location the same way they lock a face. Filmmakers asked first.",
      site: "Places tab stores environments. Wire those stills as named location refs on Animate/Movie jobs, next to Face Board.",
      tabs: ["Places", "Animate", "Movie", "Maps"],
      effort: 3,
      brief:
        "Places: ‘Pin as location ref’. Animate job payload includes location still URL + ‘same architecture, lighting, set’. One UI row: Face refs + Place ref. Reuse Face Board code.",
    },
    {
      id: "object-cut",
      heat: 83,
      title: "Take this out / put that in",
      status: "gap",
      needs: "xai",
      ask: "Remove the figure. Add a chair. Swap the object. Don’t regenerate the world.",
      why: "Object-level edit is the other half of inpaint. Phone users especially.",
      site: "Objects tab is a library. Missing: select a region on a painting and replace from Objects or a prompt.",
      tabs: ["Objects", "Gallery", "Prompt"],
      effort: 4,
      brief:
        "Can ship as the same Inpaint tab: mode ‘erase’ (fill from neighbors via prompt ‘remove, reconstruct background’) and mode ‘place object’ (pick from Objects, stamp mask). One tab, two verbs.",
    },
    {
      id: "phone-in",
      heat: 80,
      title: "Phone photo in, studio out, no drama",
      status: "partial",
      needs: "canvas",
      ask: "Shoot on the phone, land in the mix, generate, send back. Camera + LAN + HTTPS.",
      why: "Always on. If the phone path is slow or the QR is the wrong adapter, the whole studio feels dead.",
      site: "Transfer, Glimpse, Mobile Art Gen exist. Transfer was slow; thumbs + catalog limits are in. Keep this path sacred.",
      tabs: ["Transfer", "Glimpse", "Mobile Art Gen"],
      effort: 2,
      brief:
        "Don’t add a tab. Keep Transfer fast (thumbs, no ipconfig on every poll, catalog only when the tab is open). Glimpse for live camera grit. One sentence on Transfer: ‘this is how the phone feeds Spellforge.’",
    },
    {
      id: "next-work",
      heat: 77,
      title: "What do I make next?",
      status: "gap",
      needs: "xai",
      ask: "Series planner. The missing painting. The next 10. Not a random slot machine — a reason.",
      why: "Creators burn out on infinite generate. They want a directed next move from the work they already made.",
      site: "1000 paintings + generated + analyses. A Next tab can read analyses, find holes (no night interiors, no hands, no gold), and propose 3 directed prompts with parent stills.",
      tabs: ["Gallery", "Spellforge", "Ideal", "Saccade"],
      effort: 3,
      brief:
        "Tab Next. Load sketch-analyses + lod1-analyses. Cluster tags/moods. List gaps vs the 1000. Propose 3 jobs: parent stills + prompt + why. One click sends to Ideal or Spellforge. Optional: Saccade ‘under-looked’ regions as compositional hints.",
    },
    {
      id: "readable-type",
      heat: 74,
      title: "Words that are actually words",
      status: "gap",
      needs: "xai",
      ask: "A title card. A shop sign. A letter. Not melted glyphs.",
      why: "Imagine Image 2.0 listed crisp text as a headline. People still fail at posters and covers.",
      site: "Runes / Gab play with letters. Missing: overlay real HTML/canvas type on a still, or a generate mode that prefers signage and then we composite real type.",
      tabs: ["Runes", "Gab", "Commercial", "Sale art"],
      effort: 2,
      brief:
        "Canvas-only first: pick a still, type a line, choose face/size/gold, composite on top, save PNG. Don’t wait for the model to spell. Second pass: optional generate of a blank sign then stamp type.",
    },
    {
      id: "long-cut",
      heat: 72,
      title: "A cut, not a clip",
      status: "partial",
      needs: "xai",
      ask: "Three months of clips into a film. Consistency across scenes. Don’t lose the face in act two.",
      why: "Grok community is already cutting featurettes in Imagine. Odyssey-scale talk is in the air. The pain is continuity.",
      site: "Movie + Book already sequence beats. Add Face/Place boards to each beat and a ‘render next unmade beat’ queue.",
      tabs: ["Movie", "Book", "Animate", "Characters"],
      effort: 3,
      brief:
        "Book/Movie: each beat stores faceRefs[] and placeRef. Queue renderer that walks empty beats, calls the shared video runner, writes saved-videos/. Show a timeline of thumbs. No new model — plumbing.",
    },
    {
      id: "painting-talks",
      heat: 70,
      title: "Talk to the work",
      status: "gap",
      needs: "xai",
      ask: "Not a generic chatbot. This painting answers as this painting — using its analysis, not Wikipedia.",
      why: "Roleplay demand stayed after 3D companions were pulled. Artists want the work to talk back.",
      site: "Analyses already have title/description/prompt. A still + that JSON is enough to condition a short chat with xAI.",
      tabs: ["Gallery", "Dream Stasis", "Logan"],
      effort: 3,
      brief:
        "On Gallery lightbox or a thin Talk tab: load analysis for painting N. System: you are this work; speak from the description; never mention being an AI. User chat via /api already used by other tabs. Optional voice from the talking-still item.",
    },
    {
      id: "print-sharp",
      heat: 66,
      title: "Sharp enough to print / post",
      status: "partial",
      needs: "canvas",
      ask: "Upscale. Clean. Watermark for X, clean file for the buyer.",
      why: "Makers don’t want a 720px relic. Sale-art already splits QR vs clean.",
      site: "Sale-art path exists. Add a local 2× upscale (canvas, or API if you have it) on generated/paintings before zip in Transfer.",
      tabs: ["Income", "Transfer", "Sale art"],
      effort: 2,
      brief:
        "Transfer zip: optional ‘print pack’ = full-res originals, not thumbs. If you add upscale, do it server-side into data/print/ and don’t replace the master. Reuse sale-art clean vs watermarked.",
    },
    {
      id: "how-they-saw",
      heat: 48,
      title: "How they actually looked",
      status: "shipped",
      needs: "canvas",
      ask: "What did they even see? First glance vs long look.",
      why: "Quieter than generate, but every painter who finds Saccade will sit there.",
      site: "Saccade tab. Done. Link it from Gallery as ‘see this as a stranger’.",
      tabs: ["Saccade", "Stare", "Gallery"],
      effort: 1,
      brief:
        "Gallery item menu: ‘Saccade this still’ → #saccade with collection+num query. One deep link. Don’t rebuild.",
    },
  ];

  var FILTERS = [
    { id: "all", label: "All" },
    { id: "gap", label: "Not built" },
    { id: "partial", label: "Partial" },
    { id: "shipped", label: "Shipped" },
    { id: "star", label: "Starred" },
    { id: "canvas", label: "Canvas only" },
    { id: "xai", label: "Needs xAI" },
  ];

  var filter = "all";
  var stars = {};

  function $(id) {
    return document.getElementById(id);
  }

  function loadStars() {
    try {
      stars = JSON.parse(localStorage.getItem(STORAGE) || "{}") || {};
    } catch (e) {
      stars = {};
    }
  }

  function saveStars() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(stars));
    } catch (e) {}
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function statusLabel(st) {
    if (st === "shipped") return "Shipped here";
    if (st === "partial") return "Partial";
    return "Not built";
  }

  function matches(item) {
    if (filter === "all") return true;
    if (filter === "star") return !!stars[item.id];
    if (filter === "canvas") return item.needs === "canvas";
    if (filter === "xai") return item.needs === "xai";
    return item.status === filter;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject();
  }

  function render() {
    var list = $("dm-list");
    var meta = $("dm-meta");
    if (!list) return;
    var rows = ASKS.filter(matches).sort(function (a, b) {
      var as = stars[a.id] ? 1 : 0;
      var bs = stars[b.id] ? 1 : 0;
      if (as !== bs) return bs - as;
      return b.heat - a.heat;
    });
    var gaps = ASKS.filter(function (x) {
      return x.status === "gap";
    }).length;
    if (meta) {
      meta.textContent =
        rows.length +
        " shown · " +
        gaps +
        " still unbuilt on this site · star what you want next · copy the brief into a chat with Grok";
    }
    list.innerHTML = rows
      .map(function (it, idx) {
        var starOn = !!stars[it.id];
        return (
          '<article class="dm-card' +
          (starOn ? " starred" : "") +
          '" data-id="' +
          escapeHtml(it.id) +
          '">' +
          '<div class="dm-card-head">' +
          '<span class="dm-rank">HEAT ' +
          it.heat +
          "</span>" +
          '<h3 class="dm-title">' +
          escapeHtml(it.title) +
          "</h3>" +
          '<div class="dm-pills">' +
          '<span class="dm-pill ' +
          it.status +
          '">' +
          statusLabel(it.status) +
          "</span>" +
          '<span class="dm-pill">effort ' +
          it.effort +
          "/5</span>" +
          "</div></div>" +
          '<div class="dm-heat" aria-hidden="true"><span style="width:' +
          it.heat +
          '%"></span></div>' +
          '<p class="dm-ask"><strong>The ask.</strong> ' +
          escapeHtml(it.ask) +
          "</p>" +
          '<p class="dm-why"><strong>Why it’s loud.</strong> ' +
          escapeHtml(it.why) +
          "</p>" +
          '<p class="dm-how"><strong>On this site.</strong> ' +
          escapeHtml(it.site) +
          "</p>" +
          '<div class="dm-tabs">' +
          it.tabs
            .map(function (t) {
              return '<span class="dm-tab">' + escapeHtml(t) + "</span>";
            })
            .join("") +
          "</div>" +
          '<div class="dm-actions">' +
          '<button type="button" class="dm-star' +
          (starOn ? " starred" : "") +
          '" data-star="' +
          escapeHtml(it.id) +
          '">' +
          (starOn ? "Starred" : "Star as next") +
          "</button>" +
          '<button type="button" data-copy="' +
          escapeHtml(it.id) +
          '">Copy build brief</button>' +
          "</div></article>"
        );
      })
      .join("");
  }

  function briefFor(id) {
    var it = ASKS.filter(function (x) {
      return x.id === id;
    })[0];
    if (!it) return "";
    return (
      "Build this on the 1000 Paintings gallery.\n\n" +
      it.title +
      " (heat " +
      it.heat +
      ", " +
      statusLabel(it.status) +
      ", effort " +
      it.effort +
      "/5)\n\n" +
      it.ask +
      "\n\n" +
      it.site +
      "\n\nImplementation:\n" +
      it.brief +
      "\n\nTouch tabs: " +
      it.tabs.join(", ") +
      ".\nOnly modify what’s required. Match existing gallery style."
    );
  }

  function bind() {
    if (!$("panel-demand")) return;
    loadStars();
    var filters = $("dm-filters");
    if (filters) {
      filters.innerHTML = FILTERS.map(function (f, i) {
        return (
          '<button type="button" class="dm-chip' +
          (i === 0 ? " active" : "") +
          '" data-filter="' +
          f.id +
          '">' +
          f.label +
          "</button>"
        );
      }).join("");
      filters.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest(".dm-chip") : null;
        if (!b) return;
        filter = b.getAttribute("data-filter") || "all";
        filters.querySelectorAll(".dm-chip").forEach(function (x) {
          x.classList.toggle("active", x === b);
        });
        render();
      });
    }
    var list = $("dm-list");
    if (list) {
      list.addEventListener("click", function (e) {
        var star = e.target && e.target.closest ? e.target.closest("[data-star]") : null;
        if (star) {
          var id = star.getAttribute("data-star");
          if (stars[id]) delete stars[id];
          else stars[id] = 1;
          saveStars();
          render();
          return;
        }
        var copy = e.target && e.target.closest ? e.target.closest("[data-copy]") : null;
        if (copy) {
          var bid = copy.getAttribute("data-copy");
          copyText(briefFor(bid)).then(
            function () {
              copy.textContent = "Copied";
              setTimeout(function () {
                copy.textContent = "Copy build brief";
              }, 1200);
            },
            function () {}
          );
        }
      });
    }
    render();
  }

  function onShow() {
    document.body.classList.add("dm-tab-active");
    render();
  }

  function onHide() {
    document.body.classList.remove("dm-tab-active");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.addEventListener("demand-show", onShow);
  window.addEventListener("demand-hide", onHide);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "demand") onShow();
    else onHide();
  });

  window.Demand = { onShow: onShow, onHide: onHide, asks: ASKS };
})();
