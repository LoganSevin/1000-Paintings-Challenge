(function () {
  const tabs = document.querySelectorAll(".site-tabs .tab");
  document.body.setAttribute("data-active-tab", "gallery");
  const panels = {
    gallery: document.getElementById("panel-gallery"),
    pulse: document.getElementById("panel-pulse"),
    spellforge: document.getElementById("panel-spellforge"),
    muralwalk: document.getElementById("panel-muralwalk"),
    "fleeting-idea": document.getElementById("panel-fleeting-idea"),
    conceptualizer: document.getElementById("panel-conceptualizer"),
    "mobile-art-gen": document.getElementById("panel-mobile-art-gen"),
    animate: document.getElementById("panel-animate"),
    characters: document.getElementById("panel-characters"),
    objects: document.getElementById("panel-objects"),
    places: document.getElementById("panel-rooms"),
    api: document.getElementById("panel-api"),
    spells: document.getElementById("panel-spells"),
    prompt: document.getElementById("panel-prompt"),
    gab: document.getElementById("panel-gab"),
    glimpse: document.getElementById("panel-glimpse"),
    brew: document.getElementById("panel-brew"),
    ears: document.getElementById("panel-ears"),
    viral: document.getElementById("panel-viral"),
    logan: document.getElementById("panel-logan"),
    movie: document.getElementById("panel-movie"),
    book: document.getElementById("panel-book"),
    game: document.getElementById("panel-game"),
    commercial: document.getElementById("panel-commercial"),
    income: document.getElementById("panel-income"),
    market: document.getElementById("panel-market"),
    supermarket: document.getElementById("panel-supermarket"),
    ideal: document.getElementById("panel-ideal"),
    match: document.getElementById("panel-match"),
    transfer: document.getElementById("panel-transfer"),
    fight: document.getElementById("panel-fight"),
    citations: document.getElementById("panel-citations"),
    plasma: document.getElementById("panel-plasma"),
    spellshop: document.getElementById("panel-spellshop"),
  };
  const subtitle = document.getElementById("header-subtitle");
  const stats = document.getElementById("stats");

  const ARTIST =
    (typeof window !== "undefined" && window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) ||
    "Logan Sevin";
  const subtitles = {
    gallery: "Art by " + ARTIST + " — original works, authored & owned by the artist",
    pulse: "Share updates, WIPs, and reactions — a social feed for " + ARTIST + "’s gallery",
    spellforge: "Shuffled spellbook — paint with " + ARTIST + "’s 1000 works",
    muralwalk: "Walk the mural — " + ARTIST + "’s paintings as living floor",
    "fleeting-idea": "Overhead projector — acetate on glass, slide, stack, project",
    conceptualizer: "Slot reels — spin paintings into new visions under " + ARTIST + "’s authorship",
    "mobile-art-gen": "Drag spells upward — compose & refine visions on phone or desktop",
    animate: "Cast spells into motion — clips authored in " + ARTIST + "’s studio",
    characters: "Studio characters — Z-spin turntable, save & cast in Animate",
    objects: "Props & items — studio objects, save & @tag in Animate",
    places: "Places & environments — scenes for Animate",
    api: "Chain spells into pipelines — generate callable chain APIs",
    spells: "Cast spells into images — " + ARTIST + "’s gallery DNA",
    prompt: "Drop images — studio prompt tools you can edit and copy",
    gab: "Pyramid letter finishers — generate visions, drag spells to cast",
    glimpse: "Live camera poses with spell grit — filter texture on your real scene",
    brew: "A–Z spell alphabet — stanza weight into visual blend",
    ears: "Imagined spell sounds — gallery spells become audio",
    viral: "Spell chains — fuse hybrid forms, photo-to-life per chain",
    logan: ARTIST + " — face-locked scenes and animation fused with gallery style",
    movie: "Hour-scale follow-along — clips from bulk-random spells",
    book: "Open-book script — pages 1–360, edit each 10s beat",
    game: "Brush Dash — fuse 6 paintings into a boss",
    commercial: "Brand partnerships — campaign pieces under " + ARTIST + " authorship",
    income: "Get paid on X · fans tip Cash App · track rent/food/gas",
    market: "Practice only — sim sales & paper trades",
    supermarket: "Art supermarket — aisles, shoppers, receipts → generate",
    ideal: "Ideal — prompt-only image/video. Saves to Generated / Videos",
    match: "Match-3 — stripes, bombs, color poppers",
    transfer: "Transfer — PC ↔ phone photos",
    fight: "Fight — " + ARTIST + "’s stage · fighters · training · LAN",
    citations: "Citations — studio tools inventory + external services you use",
    plasma: "Plasma — touch the orb · cast 35 spell visions in a circular ring",
    spellshop: "Spell Shop — stock 35 visions from paintings + generated · animate all",
  };

  function hideOtherTabs(name) {
    if (name !== "spellforge") {
      window.dispatchEvent(new Event("spellforge-hide"));
    }
    if (name !== "muralwalk") {
      window.dispatchEvent(new Event("muralwalk-hide"));
    }
  }

  function showTab(name) {
    if (name === "rooms") name = "places";
    document.body.setAttribute("data-active-tab", name);
    if (window.TabDebug && window.TabDebug.setActiveTab) {
      window.TabDebug.setActiveTab(name);
    }
    window.dispatchEvent(new CustomEvent("tab-changed", { detail: { tab: name } }));
    if (name !== "gab") {
      window.dispatchEvent(new Event("gab-hide"));
    }
    if (name !== "glimpse") {
      window.dispatchEvent(new Event("glimpse-hide"));
    }
    if (name !== "brew") {
      window.dispatchEvent(new Event("brew-hide"));
    }
    if (name !== "ears") {
      window.dispatchEvent(new Event("ears-hide"));
    }
    if (name !== "viral") {
      window.dispatchEvent(new Event("viral-hide"));
    }
    if (name !== "logan") {
      window.dispatchEvent(new Event("logan-hide"));
    }
    if (name !== "movie") {
      window.dispatchEvent(new Event("movie-hide"));
    }
    if (name !== "book") {
      window.dispatchEvent(new Event("book-hide"));
    }
    if (name !== "game") {
      window.dispatchEvent(new Event("game-hide"));
    }
    if (name !== "prompt") {
      window.dispatchEvent(new Event("prompt-hide"));
    }
    if (name !== "commercial") {
      window.dispatchEvent(new Event("commercial-hide"));
    }
    if (name !== "market") {
      window.dispatchEvent(new Event("market-hide"));
    }
    if (name !== "income") {
      window.dispatchEvent(new Event("income-hide"));
    }
    if (name !== "supermarket") {
      window.dispatchEvent(new Event("supermarket-hide"));
    }
    if (name !== "ideal") {
      window.dispatchEvent(new Event("ideal-hide"));
    }
    if (name !== "match") {
      window.dispatchEvent(new Event("match-hide"));
    }
    if (name !== "transfer") {
      window.dispatchEvent(new Event("transfer-hide"));
    }
    if (name !== "fight") {
      window.dispatchEvent(new Event("fight-hide"));
    }
    if (name !== "plasma") {
      window.dispatchEvent(new Event("plasma-hide"));
    }
    if (name !== "spellshop") {
      window.dispatchEvent(new Event("spellshop-hide"));
    }
    document.body.classList.toggle("ct-tab-active", name === "citations");
    document.body.classList.toggle("pl-tab-active", name === "plasma");
    document.body.classList.toggle("ss-tab-active", name === "spellshop");
    document.body.classList.toggle("fi-tab-active", name === "fleeting-idea");
    document.body.classList.toggle("mag-tab-active", name === "mobile-art-gen");
    document.body.classList.toggle("an-tab-active", name === "animate");
    document.body.classList.toggle("ch-tab-active", name === "characters");
    document.body.classList.toggle("ob-tab-active", name === "objects");
    document.body.classList.toggle("rm-tab-active", name === "places");
    document.body.classList.toggle("pulse-tab-active", name === "pulse");
    document.body.classList.toggle("api-tab-active", name === "api");
    document.body.classList.toggle("sp-tab-active", name === "spells");
    document.body.classList.toggle("pr-tab-active", name === "prompt");
    document.body.classList.toggle("gb-tab-active", name === "gab");
    document.body.classList.toggle("gl-tab-active", name === "glimpse");
    document.body.classList.toggle("br-tab-active", name === "brew");
    document.body.classList.toggle("ea-tab-active", name === "ears");
    document.body.classList.toggle("vi-tab-active", name === "viral");
    document.body.classList.toggle("lo-tab-active", name === "logan");
    document.body.classList.toggle("mv-tab-active", name === "movie");
    document.body.classList.toggle("bk-tab-active", name === "book");
    document.body.classList.toggle("gm-tab-active", name === "game");
    document.body.classList.toggle("co-tab-active", name === "commercial");
    document.body.classList.toggle("ri-tab-active", name === "income");
    document.body.classList.toggle("mk-tab-active", name === "market");
    document.body.classList.toggle("sm-tab-active", name === "supermarket");
    document.body.classList.toggle("id-tab-active", name === "ideal");
    document.body.classList.toggle("mt-tab-active", name === "match");
    document.body.classList.toggle("tf-tab-active", name === "transfer");
    document.body.classList.toggle("ft-tab-active", name === "fight");

    if (name !== "fleeting-idea") {
      var ws = document.getElementById("fi-workspace");
      if (ws) {
        ws.classList.remove("fi-interface-hidden");
      }
      document.body.classList.remove("fi-interface-hidden");
      var restore = document.getElementById("fi-restore-interface");
      if (restore) restore.hidden = true;
      var toggle = document.getElementById("fi-toggle-interface");
      if (toggle) toggle.hidden = false;
    }
    tabs.forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    Object.entries(panels).forEach(([key, el]) => {
      if (!el) return;
      const on = key === name;
      el.hidden = !on;
      el.classList.toggle("active", on);
    });
    if (subtitle) subtitle.textContent = subtitles[name] || subtitles.gallery;
    if (stats) stats.style.display = name === "gallery" ? "" : "none";
    location.hash = name === "gallery" ? "" : name;

    if (name === "spellforge") {
      window.dispatchEvent(new Event("spellforge-show"));
      if (window.SpellforgeAPI && window.SpellforgeAPI.onShow) {
        window.SpellforgeAPI.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "muralwalk") {
      window.dispatchEvent(new Event("muralwalk-show"));
      if (window.MuralwalkAPI && window.MuralwalkAPI.onShow) {
        window.MuralwalkAPI.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "fleeting-idea") {
      window.dispatchEvent(new Event("fleeting-idea-show"));
      hideOtherTabs(name);
    } else if (name === "conceptualizer") {
      window.dispatchEvent(new Event("conceptualizer-show"));
      if (window.Conceptualizer && window.Conceptualizer.onShow) {
        window.Conceptualizer.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "mobile-art-gen") {
      window.dispatchEvent(new Event("mobile-art-gen-show"));
      if (window.MobileArtGen && window.MobileArtGen.onShow) {
        window.MobileArtGen.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "animate") {
      window.dispatchEvent(new Event("animate-show"));
      if (window.Animate && window.Animate.onShow) {
        window.Animate.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "characters") {
      window.dispatchEvent(new Event("characters-show"));
      if (window.Characters && window.Characters.onShow) {
        window.Characters.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "objects") {
      window.dispatchEvent(new Event("objects-show"));
      if (window.Objects && window.Objects.onShow) {
        window.Objects.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "places") {
      window.dispatchEvent(new Event("rooms-show"));
      if (window.Rooms && window.Rooms.onShow) {
        window.Rooms.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "pulse") {
      window.dispatchEvent(new Event("pulse-show"));
      if (window.Pulse && window.Pulse.onShow) {
        window.Pulse.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "api") {
      window.dispatchEvent(new Event("api-chain-show"));
      if (window.ApiChain && window.ApiChain.onShow) {
        window.ApiChain.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "spells") {
      window.dispatchEvent(new Event("spells-show"));
      if (window.Spells && window.Spells.onShow) {
        window.Spells.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "prompt") {
      window.dispatchEvent(new Event("prompt-show"));
      if (window.PromptLab && window.PromptLab.onShow) {
        window.PromptLab.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "gab") {
      window.dispatchEvent(new Event("gab-show"));
      if (window.Gab && window.Gab.onShow) {
        window.Gab.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "glimpse") {
      window.dispatchEvent(new Event("glimpse-show"));
      if (window.Glimpse && window.Glimpse.onShow) {
        window.Glimpse.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "brew") {
      window.dispatchEvent(new Event("brew-show"));
      if (window.Brew && window.Brew.onShow) {
        window.Brew.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "ears") {
      window.dispatchEvent(new Event("ears-show"));
      if (window.Ears && window.Ears.onShow) {
        window.Ears.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "viral") {
      window.dispatchEvent(new Event("viral-show"));
      if (window.Viral && window.Viral.onShow) {
        window.Viral.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "logan") {
      window.dispatchEvent(new Event("logan-show"));
      if (window.Logan && window.Logan.onShow) {
        window.Logan.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "movie") {
      window.dispatchEvent(new Event("movie-show"));
      if (window.Movie && window.Movie.onShow) {
        window.Movie.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "book") {
      window.dispatchEvent(new Event("book-show"));
      if (window.Book && window.Book.onShow) {
        window.Book.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "game") {
      window.dispatchEvent(new Event("game-show"));
      if (window.Game && window.Game.onShow) {
        window.Game.onShow();
      }
      hideOtherTabs(name);
    } else if (name === "commercial") {
      window.dispatchEvent(new Event("commercial-show"));
      if (window.Commercial && window.Commercial.onShow) {
        window.Commercial.onShow();
      }
      hideOtherTabs(name);
    } else {
      window.dispatchEvent(new Event("fleeting-idea-hide"));
      hideOtherTabs(name);
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  });

  function openFromHash() {
    const hash = location.hash.replace("#", "");
    if (
      hash === "pulse" ||
      hash === "spellforge" ||
      hash === "muralwalk" ||
      hash === "fleeting-idea" ||
      hash === "conceptualizer" ||
      hash === "mobile-art-gen" ||
      hash === "animate" ||
      hash === "characters" ||
      hash === "objects" ||
      hash === "rooms" ||
      hash === "places" ||
      hash === "api" ||
      hash === "spells" ||
      hash === "prompt" ||
      hash === "gab" ||
      hash === "glimpse" ||
      hash === "brew" ||
      hash === "ears" ||
      hash === "viral" ||
      hash === "logan" ||
      hash === "movie" ||
      hash === "book" ||
      hash === "game" ||
      hash === "commercial" ||
      hash === "income" ||
      hash === "market" ||
      hash === "supermarket" ||
      hash === "ideal" ||
      hash === "match" ||
      hash === "transfer" ||
      hash === "fight" ||
      hash === "citations" ||
      hash === "plasma" ||
      hash === "spellshop"
    ) {
      showTab(hash === "rooms" ? "places" : hash);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", openFromHash);
  } else {
    openFromHash();
  }
  window.addEventListener("spellforge-ready", openFromHash, { once: true });
  window.addEventListener("muralwalk-ready", openFromHash, { once: true });
  window.addEventListener("fleeting-idea-ready", openFromHash, { once: true });
  window.addEventListener("conceptualizer-ready", openFromHash, { once: true });
  window.addEventListener("mobile-art-gen-ready", openFromHash, { once: true });
  window.addEventListener("animate-ready", openFromHash, { once: true });
  window.addEventListener("characters-ready", openFromHash, { once: true });
  window.addEventListener("objects-ready", openFromHash, { once: true });
  window.addEventListener("rooms-ready", openFromHash, { once: true });
  window.addEventListener("pulse-ready", openFromHash, { once: true });
  window.addEventListener("api-chain-ready", openFromHash, { once: true });
  window.addEventListener("spells-ready", openFromHash, { once: true });
  window.addEventListener("prompt-ready", openFromHash, { once: true });
  window.addEventListener("gab-ready", openFromHash, { once: true });
  window.addEventListener("glimpse-ready", openFromHash, { once: true });
  window.addEventListener("brew-ready", openFromHash, { once: true });
  window.addEventListener("ears-ready", openFromHash, { once: true });
  window.addEventListener("viral-ready", openFromHash, { once: true });
  window.addEventListener("logan-ready", openFromHash, { once: true });
  window.addEventListener("movie-ready", openFromHash, { once: true });
  window.addEventListener("book-ready", openFromHash, { once: true });
  window.addEventListener("game-ready", openFromHash, { once: true });
  window.addEventListener("commercial-ready", openFromHash, { once: true });
  window.addEventListener("ideal-ready", openFromHash, { once: true });
  window.addEventListener("match-ready", openFromHash, { once: true });
  window.addEventListener("transfer-ready", openFromHash, { once: true });
})();