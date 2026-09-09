const PAINTINGS_BASE = "paintings/";
const MANIFEST_URL = "data/manifest.json";
const ANALYSES_URL = "data/analyses.json";
const LOD1_MANIFEST_URL = "data/lod1-manifest.json";
const LOD1_MANIFEST_API = "/api/lod1-manifest";
const LOD1_ANALYSES_URL = "data/lod1-analyses.json";
const PAGE_SIZE = 48;
const REFRESH_MS = 10000;
const LOD1_REFRESH_MS = 12000;
const IS_LOCAL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";
const CAN_USE_GALLERY_API =
  location.protocol === "http:" || location.protocol === "https:";

function galleryApiUrl(path) {
  const base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

function resolveGalleryUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) {
    if (CAN_USE_GALLERY_API) return galleryApiUrl(raw);
    return raw.slice(1);
  }
  return raw;
}

const GALLERY_COLLECTION_META = {
  paintings: {
    title: "1000 Paintings",
    hint: "Original painting archive",
    paintingFilters: true,
  },
  generated: {
    title: "Generated visions",
    hint: "Spellforge, Fleeting Idea, studio outputs — gallery/generated/",
    paintingFilters: true,
    analyzable: true,
  },
  sketches: {
    title: "Line sketches",
    hint: "Ink line art (black on white) — gallery/sketches/ · prompts from source descriptions (verbatim)",
    paintingFilters: true,
    analyzable: true,
  },
  "sketches-inverted": {
    title: "Inverted sketches",
    hint: "Chalk-style invert (white on black) — gallery/sketches-inverted/",
    paintingFilters: true,
    analyzable: true,
  },
  characters: {
    title: "Characters",
    hint: "Saved character iterations — numbered 1, 2, 3… per name",
    paintingFilters: false,
  },
  objects: {
    title: "Objects",
    hint: "Saved object iterations — numbered 1, 2, 3… per name",
    paintingFilters: false,
  },
  places: {
    title: "Places",
    hint: "Saved place iterations — numbered 1, 2, 3… per name",
    paintingFilters: false,
  },
  stasis: {
    title: "Saved stasis",
    hint: "Center stasis tiles from Muralwalk & Spellforge saves",
    paintingFilters: false,
  },
  fallout: {
    title: "Saved fallout",
    hint: "Compass direction tiles — NW, N, NE, W, C, E, SW, S, SE",
    paintingFilters: false,
  },
  "phone-uploads": {
    title: "Phone uploads",
    hint: "From Transfer · each image is also saved into Generated so Conceptualizer, Animate, Movie, Supermarket, etc. can use it",
    paintingFilters: false,
  },
};

let manifest = [];
let analyses = {};
let lod1Manifest = [];
let lod1Analyses = {};
let lod1KnownCount = 0;
/** Sketch # → title/description/prompt (from data/sketch-analyses.json) */
let sketchAnalyses = {};
let sketchAnalysesLoadPromise = null;
let galleryCollection = "paintings";
let assetItems = [];
let filtered = [];
let visibleCount = PAGE_SIZE;
let currentIndex = null;
let lightboxNumber = null;
let lightboxAssetId = null;
let lightboxSource = "painting";
let lastAnalyzedCount = 0;
let lastLod1AnalyzedCount = 0;
let lightboxPollId = null;
const LOD1_ANALYZE_PARALLEL = 2;
const lod1AnalyzeQueue = [];
const lod1AnalyzeInflight = new Set();
const lod1AnalyzeAttempted = new Set();
const lod1AnalyzeFailed = new Set();

const $ = (sel) => document.querySelector(sel);

async function loadData() {
  if (window.loadGalleryData) {
    const data = await window.loadGalleryData();
    manifest = data.manifest;
    analyses = data.analyses || {};
  } else {
    const [manifestRes, analysesRes] = await Promise.all([
      fetch(MANIFEST_URL),
      fetch(ANALYSES_URL).catch(() => null),
    ]);
    manifest = await manifestRes.json();
    if (analysesRes?.ok) {
      analyses = await analysesRes.json();
    }
  }
  lastAnalyzedCount = countAnalyzed();
}

function paintingUrl(num) {
  return window.getPaintingUrl
    ? window.getPaintingUrl(num)
    : `${PAINTINGS_BASE}${num}.jpg`;
}

function getAnalysis(num) {
  return analyses[String(num)] || analyses[num] || null;
}

function getLod1Analysis(num) {
  return lod1Analyses[String(num)] || lod1Analyses[num] || null;
}

function generatedUrl(num) {
  return `/generated/${num}.jpg`;
}

function sketchUrl(num) {
  return `/sketches/${num}.png`;
}

function getSketchAnalysis(num) {
  return sketchAnalyses[String(num)] || sketchAnalyses[num] || null;
}

async function loadSketchAnalyses() {
  const urls = [];
  if (CAN_USE_GALLERY_API) {
    urls.push(galleryApiUrl(`/api/sketch-analyses?t=${Date.now()}`));
  }
  urls.push(`data/sketch-analyses.json?t=${Date.now()}`);
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], { cache: "default" });
      if (!res.ok) continue;
      const data = await res.json();
      // API may return {error:...} for unknown routes on old servers
      if (data && typeof data === "object" && !data.error) {
        const keys = Object.keys(data);
        if (keys.length && !("error" in data && keys.length < 3)) {
          // bulk map is keyed by sketch number strings
          const sample = data[keys[0]];
          if (sample && typeof sample === "object" && (sample.title || sample.description || sample.prompt)) {
            sketchAnalyses = data;
            return sketchAnalyses;
          }
          // if first keys look numeric, accept
          if (keys.some((k) => /^\d+$/.test(k))) {
            sketchAnalyses = data;
            return sketchAnalyses;
          }
        }
      }
    } catch (err) {
      /* try next */
    }
  }
  return sketchAnalyses;
}

function ensureSketchAnalyses() {
  if (Object.keys(sketchAnalyses).length > 0) return Promise.resolve(sketchAnalyses);
  if (sketchAnalysesLoadPromise) return sketchAnalysesLoadPromise;
  sketchAnalysesLoadPromise = loadSketchAnalyses()
    .then(() => sketchAnalyses)
    .finally(() => {
      sketchAnalysesLoadPromise = null;
    });
  return sketchAnalysesLoadPromise;
}

function sketchAnalysisSearchText(a, num) {
  if (!a) return String(num || "");
  return [
    num,
    a.title,
    a.description,
    a.prompt,
    a.source_description,
    a.source_prompt,
    a.style,
    a.mood,
    a.medium,
    (a.tags || []).join(" "),
    a.source_collection,
    a.source_num,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesSketchSearch(num, a, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const exact = parseNumberQuery(q);
  if (exact != null) return paintingNumEquals(num, exact);
  return sketchAnalysisSearchText(a, num).includes(q);
}

function mapLod1ManifestItems(data) {
  return (data.items || []).map((item) => ({
    number: item.num,
    filename: item.name,
    url: item.url || generatedUrl(item.num),
    source: "generated",
  }));
}

async function loadLod1Analyses() {
  try {
    const url = CAN_USE_GALLERY_API
      ? galleryApiUrl(`/api/lod1-analyses?t=${Date.now()}`)
      : `${LOD1_ANALYSES_URL}?t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    lod1Analyses = data;
    lastLod1AnalyzedCount = countLod1Analyzed();
  } catch (e) {
    /* keep prior cache */
  }
}

async function loadLod1Data() {
  try {
    // Lightweight list only — full lod1-analyses (~4MB) loads later when Generated is opened
    const manifestUrl = CAN_USE_GALLERY_API
      ? galleryApiUrl(`${LOD1_MANIFEST_API}?t=${Date.now()}`)
      : `${LOD1_MANIFEST_URL}?t=${Date.now()}`;
    const mRes = await fetch(manifestUrl);
    if (mRes.ok) {
      lod1Manifest = mapLod1ManifestItems(await mRes.json());
    } else if (CAN_USE_GALLERY_API) {
      const fallback = await fetch(`${LOD1_MANIFEST_URL}?t=${Date.now()}`);
      if (fallback.ok) {
        lod1Manifest = mapLod1ManifestItems(await fallback.json());
      }
    }
    // Do NOT loadLod1Analyses here — freezes the page on parse
  } catch (e) {
    lod1Manifest = [];
  }
}

let lod1AnalysesLoadPromise = null;

/** Load heavy Generated analyses only when needed (not on every page open). */
function ensureLod1Analyses() {
  if (Object.keys(lod1Analyses).length > 0) return Promise.resolve(lod1Analyses);
  if (lod1AnalysesLoadPromise) return lod1AnalysesLoadPromise;
  lod1AnalysesLoadPromise = loadLod1Analyses()
    .then(() => lod1Analyses)
    .finally(() => {
      lod1AnalysesLoadPromise = null;
    });
  return lod1AnalysesLoadPromise;
}

function countLod1Analyzed() {
  const keys = Object.keys(lod1Analyses).length;
  if (!assetItems.length && !lod1Manifest.length) return keys;
  if (!assetItems.length && lod1Manifest.length) {
    return lod1Manifest.filter((m) => getLod1Analysis(m.number)).length;
  }
  return assetItems.filter((item) => item.number != null && getLod1Analysis(item.number)).length;
}

function lod1AnalysisSearchText(a, num) {
  if (!a) return String(num ?? "");
  return [a.title, a.description, a.style, a.medium, a.mood, ...(a.tags || []), ...(a.colors || [])]
    .join(" ")
    .toLowerCase();
}

function matchesGeneratedSearch(num, a, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const exact = parseNumberQuery(q);
  if (exact != null) return paintingNumEquals(num, exact);
  return lod1AnalysisSearchText(a, num).includes(q);
}

function lod1CardStatus(num) {
  if (getLod1Analysis(num)) return "tagged";
  if (lod1AnalyzeInflight.has(num)) return "analyzing";
  if (lod1AnalyzeQueue.includes(num)) return "queued";
  if (lod1AnalyzeFailed.has(num)) return "failed";
  return "pending";
}

function updateLod1AnalyzeStatus() {
  if (galleryCollection !== "generated") return;
  const hint = $("#gallery-collection-hint");
  if (!hint) return;
  const total = assetItems.length || lod1Manifest.length;
  const done = countLod1Analyzed();
  const pending = lod1AnalyzeQueue.length + lod1AnalyzeInflight.size;
  if (total > 0 && done < total) {
    hint.textContent = pending
      ? `AI analyzing… ${done} of ${total} tagged (${pending} in queue)`
      : `${done} of ${total} tagged — bulk analysis running in background`;
  } else {
    hint.textContent = GALLERY_COLLECTION_META.generated.hint;
  }
}

function updateCardAnalysisStatus(num, status) {
  const card = document.querySelector(`#gallery .card-generated[data-number="${num}"]`);
  if (!card) return;
  const a = getLod1Analysis(num);
  if (a) return;
  const meta = card.querySelector(".card-meta");
  if (!meta) return;
  meta.outerHTML = generatedCardMetaHtml(num, null, status);
}

function enqueueLod1Analysis(num) {
  if (!CAN_USE_GALLERY_API || num == null || getLod1Analysis(num)) return;
  if (
    lod1AnalyzeAttempted.has(num) ||
    lod1AnalyzeInflight.has(num) ||
    lod1AnalyzeQueue.includes(num)
  ) {
    return;
  }
  lod1AnalyzeAttempted.add(num);
  lod1AnalyzeQueue.push(num);
  updateCardAnalysisStatus(num, "queued");
  drainLod1AnalyzeQueue();
}

async function runLod1Analysis(num) {
  updateCardAnalysisStatus(num, "analyzing");
  try {
    const res = await fetch(galleryApiUrl("/api/analyze-lod1"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ num }),
    });
    const data = res.ok ? await res.json() : null;
    if (data?.analysis) {
      lod1Analyses[String(num)] = data.analysis;
      lod1AnalyzeFailed.delete(num);
      lastLod1AnalyzedCount = countLod1Analyzed();
      patchAssetCards();
      populateStyleFilter();
      updateCollectionChrome();
      updateLod1AnalyzeStatus();
      if (lightboxSource === "generated" && lightboxNumber === num && $("#lightbox").open) {
        renderGeneratedAnalysis(num);
      }
      return;
    }
    lod1AnalyzeFailed.add(num);
    updateCardAnalysisStatus(num, "failed");
  } catch (e) {
    lod1AnalyzeFailed.add(num);
    updateCardAnalysisStatus(num, "failed");
  }
}

function drainLod1AnalyzeQueue() {
  while (lod1AnalyzeInflight.size < LOD1_ANALYZE_PARALLEL && lod1AnalyzeQueue.length) {
    const num = lod1AnalyzeQueue.shift();
    lod1AnalyzeInflight.add(num);
    runLod1Analysis(num).finally(() => {
      lod1AnalyzeInflight.delete(num);
      updateLod1AnalyzeStatus();
      drainLod1AnalyzeQueue();
    });
  }
  updateLod1AnalyzeStatus();
}

function queueLod1AnalysisForVisible() {
  if (galleryCollection !== "generated" || !CAN_USE_GALLERY_API) return;
  filtered.slice(0, visibleCount).forEach((item) => {
    if (item.number != null) enqueueLod1Analysis(item.number);
  });
}

function normalizeAssetItems(items, collection) {
  return (items || []).map((item) => {
    const version = item.version ?? item.number ?? null;
    const num =
      item.number ??
      ((collection === "generated" || collection === "sketches") && version != null
        ? Number(version)
        : null);
    const defaultTitle =
      collection === "sketches" && num != null
        ? `Sketch #${num}`
        : collection === "generated" && num != null
          ? `Generated #${num}`
          : "Asset";
    const defaultSub =
      collection === "sketches" && num != null
        ? `S#${num}`
        : collection === "generated" && num != null
          ? `G#${num}`
          : version
            ? `#${version}`
            : "";
    return {
      ...item,
      collection: item.collection || collection,
      number: num,
      url: resolveGalleryUrl(item.url),
      title: item.title || item.entity_name || defaultTitle,
      subtitle: item.subtitle || defaultSub,
      version,
    };
  });
}

async function loadAssetCollection(collection) {
  if (collection === "paintings") return [];

  // Generated: compact dream-pool (~20KB) — never pull the full 700KB+ assets list
  if (collection === "generated" && CAN_USE_GALLERY_API) {
    try {
      const res = await fetch(galleryApiUrl("/api/dream-pool"), {
        cache: "default",
      });
      if (res.ok) {
        const data = await res.json();
        const nums = Array.isArray(data.generated_nums) ? data.generated_nums : [];
        const files = data.generated_files || {};
        // Newest first for gallery grid (same as before)
        const ordered = nums.slice().reverse();
        const items = ordered.map((n) => {
          const name = files[String(n)] || `${n}.jpg`;
          return {
            id: `generated/${n}`,
            url: `/generated/${name}`,
            title: `Generated #${n}`,
            subtitle: `G#${n}`,
            version: n,
            collection: "generated",
            number: n,
            entity_name: `G#${n}`,
          };
        });
        lod1Manifest = ordered.map((n) => ({
          number: n,
          filename: files[String(n)] || `${n}.jpg`,
          url: `/generated/${files[String(n)] || n + ".jpg"}`,
          source: "generated",
        }));
        lod1KnownCount = lod1Manifest.length;
        return normalizeAssetItems(items, "generated");
      }
    } catch (err) {
      console.warn("dream-pool for gallery failed:", err);
    }
  }

  // Sketches first — own APIs + static data files (do not depend on gallery-assets)
  if (collection === "sketches" || collection === "sketches-inverted") {
    return loadSketchCollection(collection);
  }

  if (CAN_USE_GALLERY_API) {
    try {
      // Cap payload for other collections; never unbounded generated dump
      const lim = collection === "generated" ? 96 : "";
      const q = lim
        ? `?collection=${encodeURIComponent(collection)}&limit=${lim}&t=${Date.now()}`
        : `?collection=${encodeURIComponent(collection)}&t=${Date.now()}`;
      const res = await fetch(galleryApiUrl(`/api/gallery-assets${q}`), {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error && Array.isArray(data.items)) {
          return normalizeAssetItems(data.items, collection);
        }
      }
    } catch (err) {
      console.warn("Gallery assets API failed:", collection, err);
    }
  }

  if (collection === "generated") {
    await loadLod1Data();
    return normalizeAssetItems(
      lod1Manifest.map((item) => ({
        id: `generated/${item.number}`,
        url: item.url || generatedUrl(item.number),
        title: `Generated #${item.number}`,
        subtitle: `G#${item.number}`,
        version: item.number,
        collection: "generated",
        number: item.number,
        entity_name: `G#${item.number}`,
      })),
      "generated"
    );
  }
  return [];
}

/**
 * Load line sketches (or inverted chalk-style copies) for the Gallery tab.
 * Tries API → static data/sketch-manifest.json → key scan of sketch-analyses.
 */
async function loadSketchCollection(collection) {
  const inverted = collection === "sketches-inverted";
  const folder = inverted ? "sketches-inverted" : "sketches";
  const prefix = inverted ? "SI" : "S";
  try {
    await ensureSketchAnalyses();
  } catch (e) {
    /* analyses optional */
  }

  let rows = [];
  const tryUrls = [];
  if (CAN_USE_GALLERY_API) {
    tryUrls.push(galleryApiUrl(`/api/sketch-manifest?t=${Date.now()}`));
  }
  tryUrls.push(`data/sketch-manifest.json?t=${Date.now()}`);

  for (let i = 0; i < tryUrls.length; i++) {
    try {
      const res = await fetch(tryUrls[i], { cache: "default" });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length) {
        rows = data.items;
        break;
      }
      if (Array.isArray(data) && data.length) {
        rows = data;
        break;
      }
    } catch (err) {
      /* next */
    }
  }

  // Fallback: numbers from sketch-analyses bulk file
  if (!rows.length && sketchAnalyses && typeof sketchAnalyses === "object") {
    rows = Object.keys(sketchAnalyses)
      .map((k) => parseInt(k, 10))
      .filter((n) => n > 0)
      .sort((a, b) => a - b)
      .map((n) => ({ num: n, url: `/${folder}/${n}.png`, name: `${n}.png` }));
  }

  if (!rows.length && CAN_USE_GALLERY_API) {
    try {
      const res = await fetch(
        galleryApiUrl(
          `/api/gallery-assets?collection=${encodeURIComponent(collection)}&t=${Date.now()}`
        ),
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.items) && data.items.length) {
          return normalizeAssetItems(data.items, collection);
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  const ordered = rows.slice().sort((a, b) => (b.num || 0) - (a.num || 0));
  const items = ordered.map((row) => {
    const n = row.num != null ? row.num : row.number;
    const a = getSketchAnalysis(n);
    const url = inverted
      ? `/sketches-inverted/${n}.png`
      : row.url || sketchUrl(n);
    const title = inverted
      ? (a && a.inverted_title) || (a && a.title) || `Inverted sketch #${n}`
      : (a && a.title) || `Sketch #${n}`;
    const description = inverted
      ? (a && a.inverted_description) || (a && a.description) || ""
      : (a && a.description) || "";
    const prompt = inverted
      ? (a && a.inverted_prompt) || (a && a.prompt) || ""
      : (a && a.prompt) || "";
    return {
      id: `${collection}/${n}`,
      url,
      title,
      subtitle: `${prefix}#${n}`,
      version: n,
      collection,
      number: n,
      entity_name: `${prefix}#${n}`,
      description,
      prompt,
      tags: (a && a.tags) || [],
      style: (a && a.style) || "",
    };
  });
  return normalizeAssetItems(items, collection);
}

function updateCollectionChrome() {
  const meta = GALLERY_COLLECTION_META[galleryCollection] || GALLERY_COLLECTION_META.paintings;
  const titleEl = $("#gallery-collection-title");
  const hintEl = $("#gallery-collection-hint");
  const countEl = $("#gallery-collection-count");
  const filters = $("#gallery-painting-filters");
  if (titleEl) titleEl.textContent = meta.title;
  if (hintEl) hintEl.textContent = meta.hint || "";
  if (filters) filters.hidden = !meta.paintingFilters;
  document.querySelectorAll(".gallery-collection").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.collection === galleryCollection);
  });
  if (countEl) {
    const total = galleryCollection === "paintings" ? manifest.length : assetItems.length;
    const shown = filtered.length;
    if (!shown && !total) {
      countEl.textContent = CAN_USE_GALLERY_API
        ? "No items found"
        : "Run start_server.bat → http://localhost:8765";
    } else if (galleryCollection === "generated" && total > 0) {
      const analyzed = countLod1Analyzed();
      const pending = lod1AnalyzeQueue.length + lod1AnalyzeInflight.size;
      countEl.textContent = pending
        ? `${shown} shown · ${analyzed}/${total} analyzed`
        : `${shown} item${shown === 1 ? "" : "s"} · ${analyzed}/${total} analyzed`;
    } else if (shown !== total && total > 0) {
      countEl.textContent = `${shown} of ${total} items`;
    } else {
      countEl.textContent = `${shown} item${shown === 1 ? "" : "s"}`;
    }
  }
  updateLod1AnalyzeStatus();
}

function sketchCardMetaHtml(num, a, prefix) {
  const pfx = prefix || "S";
  const title = a?.title || `Sketch #${num}`;
  const titleClass = a?.title ? "" : " pending";
  const tagsHtml = (a?.tags || [])
    .slice(0, 3)
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");
  return `
    <div class="card-meta">
      <div class="card-number">${escapeHtml(pfx)}#${num}</div>
      <div class="card-title${titleClass}">${escapeHtml(title)}</div>
      ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ""}
    </div>
  `;
}

function renderAssetCard(item) {
  const card = document.createElement("article");
  card.className = "card card-asset";
  if (item.collection === "generated") card.classList.add("card-generated");
  if (item.collection === "sketches" || item.collection === "sketches-inverted") {
    card.classList.add("card-sketch");
  }
  card.dataset.assetId = item.id;
  if (item.number != null) card.dataset.number = item.number;
  card.setAttribute("role", "listitem");
  card.tabIndex = 0;

  const imgUrl = resolveGalleryUrl(item.url);
  const metaHtml =
    item.collection === "generated" && item.number != null
      ? generatedCardMetaHtml(item.number, getLod1Analysis(item.number))
      : (item.collection === "sketches" ||
            item.collection === "sketches-inverted") &&
          item.number != null
        ? sketchCardMetaHtml(
            item.number,
            getSketchAnalysis(item.number) || item,
            item.collection === "sketches-inverted" ? "SI" : "S"
          )
        : assetCardMetaHtml(item);

  card.innerHTML = `
    <div class="card-thumb">
      <img src="${imgUrl}" alt="${escapeHtml(item.title || "Asset")}" loading="lazy" width="400" height="400" />
    </div>
    ${metaHtml}
  `;
  card.addEventListener("click", () => openAssetLightbox(item));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAssetLightbox(item);
    }
  });

  if (window.GalleryShop) {
    attachShopToCard(card, window.GalleryShop.fromAsset(item));
  }

  return card;
}

function generatedCardMetaHtml(num, a, status) {
  const st = status || lod1CardStatus(num);
  let title;
  let titleClass = "";
  if (a?.title) {
    title = a.title;
  } else if (st === "analyzing") {
    title = "Analyzing…";
    titleClass = " pending analyzing";
  } else if (st === "queued") {
    title = "Queued for analysis";
    titleClass = " pending queued";
  } else if (st === "failed") {
    title = "Analysis failed";
    titleClass = " pending failed";
  } else {
    title = "Awaiting analysis";
    titleClass = " pending";
  }
  const tagsHtml = (a?.tags || [])
    .slice(0, 3)
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");
  const desc = a?.description ? String(a.description).trim() : "";
  const descHtml = desc
    ? `<div class="card-desc">${escapeHtml(desc.length > 140 ? `${desc.slice(0, 140)}…` : desc)}</div>`
    : "";
  return `
    <div class="card-meta">
      <div class="card-number">G#${num}</div>
      <div class="card-title${titleClass}">${escapeHtml(title)}</div>
      ${descHtml}
      ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ""}
    </div>
  `;
}

function assetCardMetaHtml(item) {
  const title = item.title || item.entity_name || "Asset";
  const tagsHtml = (item.tags || [])
    .slice(0, 3)
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");
  return `
    <div class="card-meta">
      <div class="card-number">${escapeHtml(item.subtitle || "")}</div>
      <div class="card-title">${escapeHtml(title)}</div>
      ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ""}
    </div>
  `;
}

function patchAssetCards() {
  if (galleryCollection !== "generated") return;
  document.querySelectorAll("#gallery .card-generated[data-number]").forEach((card) => {
    const num = Number(card.dataset.number);
    const a = getLod1Analysis(num);
    if (!a) return;
    const meta = card.querySelector(".card-meta");
    const titleEl = card.querySelector(".card-title");
    if (!meta || !titleEl?.classList.contains("pending")) return;
    meta.outerHTML = generatedCardMetaHtml(num, a);
  });
}

async function refreshActiveCollection(options = {}) {
  if (galleryCollection === "paintings" || galleryCollection === "generated") return;
  assetItems = await loadAssetCollection(galleryCollection);
  if (!options.preserveView) applyFilters();
  else applyFilters({ preserveView: true });
}

async function setGalleryCollection(collection) {
  if (!GALLERY_COLLECTION_META[collection]) return;
  galleryCollection = collection;
  visibleCount = PAGE_SIZE;
  const grid = $("#gallery");
  const countEl = $("#gallery-collection-count");
  if (grid && collection !== "paintings") {
    grid.innerHTML = `<p class="empty-state">Loading ${GALLERY_COLLECTION_META[collection].title}…</p>`;
  }
  if (countEl) countEl.textContent = "Loading…";
  try {
    if (collection !== "paintings") {
      assetItems = await loadAssetCollection(collection);
      // Render grid first — never block tabs on 4MB analyses JSON
      applyFilters();
      if (collection === "generated") {
        ensureLod1Analyses().then(() => {
          if (galleryCollection !== "generated") return;
          populateStyleFilter();
          patchAssetCards();
          updateCollectionChrome();
        });
      }
      if (collection === "sketches" || collection === "sketches-inverted") {
        ensureSketchAnalyses().then(() => {
          if (
            galleryCollection !== "sketches" &&
            galleryCollection !== "sketches-inverted"
          )
            return;
          populateStyleFilter();
          applyFilters({ preserveView: true });
          updateCollectionChrome();
        });
      }
      return;
    }
    assetItems = [];
  } catch (err) {
    console.error("Failed to load gallery collection:", collection, err);
    assetItems = [];
  }
  applyFilters();
}

function countAnalyzed() {
  return manifest.filter((m) => getAnalysis(m.number)).length;
}

function parseNumberQuery(query) {
  return window.parsePaintingNumberQuery
    ? window.parsePaintingNumberQuery(query)
    : null;
}

function paintingNumEquals(num, target) {
  if (window.paintingNumbersEqual) {
    return window.paintingNumbersEqual(num, target);
  }
  return parseInt(num, 10) === parseInt(target, 10);
}

function matchesSearch(num, a, query) {
  if (window.paintingMatchesSearch) {
    return window.paintingMatchesSearch(num, a, query);
  }
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const exact = parseNumberQuery(q);
  if (exact != null) return paintingNumEquals(num, exact);
  const meta = window.buildMetadataSearchText
    ? window.buildMetadataSearchText(a)
    : "";
  return meta.includes(q);
}

function applyFilters(options = {}) {
  const preserveView = options.preserveView === true;
  const scrollY = preserveView ? window.scrollY : 0;
  const prevVisible = visibleCount;

  const qRaw = $("#search").value.trim();
  const q = qRaw.toLowerCase();
  const numericQuery =
    window.numericQueryDigits && window.numericQueryDigits(qRaw);
  const style = $("#filter-style").value;
  const onlyAnalyzed = $("#only-analyzed").checked;
  const sort = $("#sort").value;

  updateCollectionChrome();

  if (galleryCollection === "paintings") {
    filtered = manifest.filter((item) => {
      const a = getAnalysis(item.number);
      if (onlyAnalyzed && !a) return false;
      if (style && a?.style !== style) return false;
      if (q && !matchesSearch(item.number, a, qRaw)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const na = a.number;
      const nb = b.number;
      if (numericQuery != null && window.paintingNumericSearchRank) {
        const ra = window.paintingNumericSearchRank(na, qRaw);
        const rb = window.paintingNumericSearchRank(nb, qRaw);
        if (ra !== rb) return ra - rb;
      }
      const ta = (getAnalysis(na)?.title || "").toLowerCase();
      const tb = (getAnalysis(nb)?.title || "").toLowerCase();
      switch (sort) {
        case "number-desc":
          return nb - na;
        case "title-asc":
          return ta.localeCompare(tb) || na - nb;
        default:
          return na - nb;
      }
    });
  } else if (galleryCollection === "generated") {
    filtered = assetItems.filter((item) => {
      const num = item.number;
      const a = num != null ? getLod1Analysis(num) : null;
      if (onlyAnalyzed && !a) return false;
      if (style && a?.style !== style) return false;
      if (q && !matchesGeneratedSearch(num, a, qRaw)) return false;
      return true;
    });
    filtered.sort((a, b) => {
      const na = a.number ?? 0;
      const nb = b.number ?? 0;
      if (numericQuery != null && window.paintingNumericSearchRank) {
        const ra = window.paintingNumericSearchRank(na, qRaw);
        const rb = window.paintingNumericSearchRank(nb, qRaw);
        if (ra !== rb) return ra - rb;
      }
      const ta = (getLod1Analysis(na)?.title || a.title || "").toLowerCase();
      const tb = (getLod1Analysis(nb)?.title || b.title || "").toLowerCase();
      switch (sort) {
        case "number-desc":
          return nb - na;
        case "title-asc":
          return ta.localeCompare(tb) || na - nb;
        case "shuffle":
          return Math.random() - 0.5;
        default:
          return na - nb;
      }
    });
  } else if (
    galleryCollection === "sketches" ||
    galleryCollection === "sketches-inverted"
  ) {
    filtered = assetItems.filter((item) => {
      const num = item.number;
      const a = num != null ? getSketchAnalysis(num) : null;
      if (onlyAnalyzed && !a) return false;
      if (style && (a?.style || item.style) !== style) return false;
      if (q && !matchesSketchSearch(num, a || item, qRaw)) return false;
      return true;
    });
    filtered.sort((a, b) => {
      const na = a.number ?? 0;
      const nb = b.number ?? 0;
      if (numericQuery != null && window.paintingNumericSearchRank) {
        const ra = window.paintingNumericSearchRank(na, qRaw);
        const rb = window.paintingNumericSearchRank(nb, qRaw);
        if (ra !== rb) return ra - rb;
      }
      const ta = (getSketchAnalysis(na)?.title || a.title || "").toLowerCase();
      const tb = (getSketchAnalysis(nb)?.title || b.title || "").toLowerCase();
      switch (sort) {
        case "number-desc":
          return nb - na;
        case "title-asc":
          return ta.localeCompare(tb) || na - nb;
        case "shuffle":
          return Math.random() - 0.5;
        default:
          return na - nb;
      }
    });
  } else {
    filtered = assetItems.filter((item) => {
      if (!q) return true;
      const meta = [item.title, item.entity_name, item.subtitle, item.version, item.number]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return meta.includes(q);
    });
    filtered.sort((a, b) => {
      const va = a.version || a.number || 0;
      const vb = b.version || b.number || 0;
      if (sort === "title-asc") {
        return String(a.title || "").localeCompare(String(b.title || "")) || vb - va;
      }
      if (sort === "number-asc") return va - vb;
      return vb - va;
    });
  }

  visibleCount = preserveView ? Math.min(prevVisible, filtered.length) : PAGE_SIZE;
  renderFull();
  if (preserveView) {
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }
  syncLightboxIndex();
}

function syncLightboxIndex() {
  if (lightboxSource === "painting" && lightboxNumber != null) {
    const idx = filtered.findIndex((f) => f.number === lightboxNumber);
    if (idx >= 0) currentIndex = idx;
    return;
  }
  if (lightboxAssetId) {
    const idx = filtered.findIndex((f) => f.id === lightboxAssetId);
    if (idx >= 0) currentIndex = idx;
  }
}

function updateStats() {
  $("#stat-total").textContent = manifest.length;
  $("#stat-analyzed").textContent = countAnalyzed();
}

function populateStyleFilter() {
  const styles = new Set();
  if (galleryCollection === "generated") {
    Object.values(lod1Analyses).forEach((a) => {
      if (a?.style) styles.add(a.style);
    });
  } else if (
    galleryCollection === "sketches" ||
    galleryCollection === "sketches-inverted"
  ) {
    Object.values(sketchAnalyses).forEach((a) => {
      if (a?.style) styles.add(a.style);
    });
  } else {
    for (const item of manifest) {
      const s = getAnalysis(item.number)?.style;
      if (s) styles.add(s);
    }
  }
  const select = $("#filter-style");
  const current = select.value;
  select.querySelectorAll("option:not([value=''])").forEach((o) => o.remove());
  [...styles].sort().forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  });
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function attachShopToCard(card, shopItem) {
  if (!card || !shopItem || !window.GalleryShop) return;
  const existing = card.querySelector(".card-purchase");
  if (existing) existing.remove();
  card.insertAdjacentHTML("beforeend", window.GalleryShop.cardPurchaseHtml(shopItem));
  window.GalleryShop.bindCardPurchase(card, shopItem);
}

function cardMetaHtml(num, a) {
  const title = a?.title || "Awaiting analysis";
  const titleClass = a ? "" : " pending";
  const tagsHtml = (a?.tags || [])
    .slice(0, 3)
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");
  return `
    <div class="card-meta">
      <div class="card-number">#${num}</div>
      <div class="card-title${titleClass}">${escapeHtml(title)}</div>
      ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ""}
    </div>
  `;
}

function renderCard(item, options = {}) {
  const a = getAnalysis(item.number);
  const card = document.createElement("article");
  card.className = "card";
  if (options.exactMatch) card.classList.add("search-exact");
  card.setAttribute("role", "listitem");
  card.tabIndex = 0;
  card.dataset.number = item.number;

  card.innerHTML = `
    <div class="card-thumb">
      <img src="${paintingUrl(item.number)}" alt="Painting ${item.number}" loading="lazy" width="400" height="400" />
    </div>
    ${cardMetaHtml(item.number, a)}
  `;

  card.addEventListener("click", () => openLightbox(item.number));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLightbox(item.number);
    }
  });

  if (window.GalleryShop) {
    attachShopToCard(card, window.GalleryShop.fromPainting(item.number));
  }

  return card;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderFull() {
  const grid = $("#gallery");
  grid.innerHTML = "";
  const qRaw = $("#search").value.trim();
  const emptyMsg =
    galleryCollection === "paintings"
      ? "No paintings match your filters."
      : assetItems.length === 0
        ? CAN_USE_GALLERY_API
          ? `No images in gallery/${galleryCollection === "generated" ? "generated" : galleryCollection}/ yet.`
          : "Open via the server: run start_server.bat, then http://localhost:8765 (not the HTML file directly)."
        : `No ${GALLERY_COLLECTION_META[galleryCollection]?.title?.toLowerCase() || "items"} match your search.`;

  if (filtered.length === 0) {
    grid.innerHTML = `<p class="empty-state">${emptyMsg}</p>`;
    $("#load-more-wrap").hidden = true;
    updateCollectionChrome();
    return;
  }

  filtered.slice(0, visibleCount).forEach((item) => {
    if (galleryCollection === "paintings") {
      grid.appendChild(
        renderCard(item, {
          exactMatch:
            window.isPrimaryNumericSearchHit &&
            window.isPrimaryNumericSearchHit(item.number, qRaw),
        })
      );
    } else {
      grid.appendChild(renderAssetCard(item));
    }
  });

  updateLoadMoreButton();
  updateCollectionChrome();
  queueLod1AnalysisForVisible();
}

function updateLoadMoreButton() {
  $("#load-more-wrap").hidden = visibleCount >= filtered.length;
}

function appendMoreCards() {
  const grid = $("#gallery");
  const start = visibleCount - PAGE_SIZE;
  const end = visibleCount;
  const qRaw = $("#search").value.trim();

  filtered.slice(start, end).forEach((item) => {
    if (galleryCollection === "paintings") {
      grid.appendChild(
        renderCard(item, {
          exactMatch:
            window.isPrimaryNumericSearchHit &&
            window.isPrimaryNumericSearchHit(item.number, qRaw),
        })
      );
    } else {
      grid.appendChild(renderAssetCard(item));
    }
  });

  updateLoadMoreButton();
  queueLod1AnalysisForVisible();

  const firstNew =
    galleryCollection === "paintings"
      ? grid.querySelector(`[data-number="${filtered[start]?.number}"]`)
      : grid.querySelector(`[data-asset-id="${filtered[start]?.id}"]`);
  firstNew?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Update card titles/tags in place — no scroll reset, no lightbox change. */
function patchVisibleCards() {
  document.querySelectorAll("#gallery .card[data-number]").forEach((card) => {
    const num = Number(card.dataset.number);
    const a = getAnalysis(num);
    if (!a) return;

    const meta = card.querySelector(".card-meta");
    const titleEl = card.querySelector(".card-title");
    if (!meta || !titleEl?.classList.contains("pending")) return;

    meta.outerHTML = cardMetaHtml(num, a);
  });
}

function renderGeneratedAnalysis(num) {
  const body = $("#analysis-body");
  const a = getLod1Analysis(num);

  if (!a) {
    enqueueLod1Analysis(num);
    body.innerHTML = `
      <p class="analysis-pending">Analysis in progress… tags and description will appear shortly.</p>
    `;
    return;
  }

  const tags = (a.tags || [])
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");

  const colors = (a.colors || [])
    .map(
      (c) =>
        `<span class="tag" title="${escapeHtml(c)}">${escapeHtml(c)}</span>`
    )
    .join("");

  body.innerHTML = `
    <h2>${escapeHtml(a.title || `Generated vision ${num}`)}</h2>
    <p class="description">${escapeHtml(a.description || "")}</p>
    <dl class="analysis-meta">
      ${a.subject_type ? `<div><dt>Subject</dt><dd>${escapeHtml(a.subject_type)}</dd></div>` : ""}
      ${a.style ? `<div><dt>Style</dt><dd>${escapeHtml(a.style)}</dd></div>` : ""}
      ${a.medium ? `<div><dt>Medium</dt><dd>${escapeHtml(a.medium)}</dd></div>` : ""}
      ${a.mood ? `<div><dt>Mood</dt><dd>${escapeHtml(a.mood)}</dd></div>` : ""}
    </dl>
    ${tags ? `<div class="analysis-tags">${tags}</div>` : ""}
    ${colors ? `<p style="margin-top:1rem;font-size:0.85rem;color:var(--text-muted)">Palette</p><div class="analysis-tags">${colors}</div>` : ""}
  `;
}

function renderSketchAnalysis(num) {
  const body = $("#analysis-body");
  const a = getSketchAnalysis(num);
  const inverted = galleryCollection === "sketches-inverted";

  if (!a) {
    body.innerHTML = `
      <h2>Sketch #${num}</h2>
      <p class="analysis-pending">No prompt meta yet — run <code>python scripts/build_sketch_meta.py</code> then refresh.</p>
    `;
    return;
  }

  const title = inverted
    ? a.inverted_title || a.title || `Inverted sketch #${num}`
    : a.title || `Sketch #${num}`;
  const description = inverted
    ? a.inverted_description || a.description || ""
    : a.description || "";
  const prompt = inverted ? a.inverted_prompt || a.prompt || "" : a.prompt || "";
  const medium = inverted
    ? a.inverted_medium || "white chalk on black"
    : a.medium || "ink line sketch";

  const tags = (a.tags || [])
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");

  const origin =
    a.source_collection && a.source_num
      ? `${a.source_collection} #${a.source_num}`
      : a.source_url || "";

  body.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    <p class="description">${escapeHtml(description)}</p>
    ${
      prompt
        ? `<p style="margin-top:0.75rem;font-size:0.9rem"><strong>Prompt</strong></p>
           <p class="description">${escapeHtml(prompt)}</p>`
        : ""
    }
    ${
      a.source_description
        ? `<p style="margin-top:0.75rem;font-size:0.85rem;color:var(--text-muted)"><strong>Colored source (reference only)</strong></p>
           <p class="description">${escapeHtml(a.source_description)}</p>`
        : ""
    }
    <dl class="analysis-meta">
      <div><dt>Medium</dt><dd>${escapeHtml(medium)}</dd></div>
      ${a.style ? `<div><dt>Style</dt><dd>${escapeHtml(a.style)}</dd></div>` : ""}
      ${a.mood ? `<div><dt>Mood</dt><dd>${escapeHtml(a.mood)}</dd></div>` : ""}
      ${origin ? `<div><dt>From</dt><dd>${escapeHtml(origin)}</dd></div>` : ""}
    </dl>
    ${tags ? `<div class="analysis-tags">${tags}</div>` : ""}
  `;
}

function renderAnalysis(num) {
  const body = $("#analysis-body");
  const a = getAnalysis(num);

  if (!a) {
    body.innerHTML = `
      <p class="analysis-pending">Analysis in progress… check back in a moment.</p>
    `;
    return;
  }

  const tags = (a.tags || [])
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");

  const colors = (a.colors || [])
    .map(
      (c) =>
        `<span class="tag" title="${escapeHtml(c)}">${escapeHtml(c)}</span>`
    )
    .join("");

  body.innerHTML = `
    <h2>${escapeHtml(a.title || `Painting ${num}`)}</h2>
    <p class="description">${escapeHtml(a.description || "")}</p>
    <dl class="analysis-meta">
      ${a.style ? `<div><dt>Style</dt><dd>${escapeHtml(a.style)}</dd></div>` : ""}
      ${a.medium ? `<div><dt>Medium</dt><dd>${escapeHtml(a.medium)}</dd></div>` : ""}
      ${a.mood ? `<div><dt>Mood</dt><dd>${escapeHtml(a.mood)}</dd></div>` : ""}
    </dl>
    ${tags ? `<div class="analysis-tags">${tags}</div>` : ""}
    ${colors ? `<p style="margin-top:1rem;font-size:0.85rem;color:var(--text-muted)">Palette</p><div class="analysis-tags">${colors}</div>` : ""}
  `;
}

function startLightboxPoll() {
  stopLightboxPoll();
  lightboxPollId = setInterval(async () => {
    if (!lightboxNumber || !$("#lightbox").open) return;
    if (lightboxSource === "generated") {
      const had = getLod1Analysis(lightboxNumber);
      await loadLod1Analyses();
      if (!had && getLod1Analysis(lightboxNumber)) {
        renderGeneratedAnalysis(lightboxNumber);
        patchAssetCards();
      }
      return;
    }
    const had = getAnalysis(lightboxNumber);
    const res = await fetch(`${ANALYSES_URL}?t=${Date.now()}`);
    if (!res.ok) return;
    analyses = await res.json();
    lastAnalyzedCount = countAnalyzed();
    updateStats();
    if (!had && getAnalysis(lightboxNumber)) {
      renderAnalysis(lightboxNumber);
      patchVisibleCards();
    }
  }, 3000);
}

function stopLightboxPoll() {
  if (lightboxPollId) clearInterval(lightboxPollId);
  lightboxPollId = null;
}

function openAssetLightbox(item) {
  lightboxAssetId = item.id;
  lightboxNumber = item.number ?? null;
  lightboxSource =
    item.collection === "generated"
      ? "generated"
      : item.collection === "sketches"
        ? "sketch"
        : "asset";
  syncLightboxIndex();
  showLightboxAsset(item);
  if (window.galleryDialog) window.galleryDialog.open($("#lightbox"));
  else $("#lightbox").showModal();
  startLightboxPoll();
}

function openLightbox(num) {
  lightboxSource = "painting";
  lightboxNumber = num;
  lightboxAssetId = null;
  syncLightboxIndex();

  showLightboxPainting(num);
  if (window.galleryDialog) window.galleryDialog.open($("#lightbox"));
  else $("#lightbox").showModal();
  startLightboxPoll();
}

function showLightboxPainting(num) {
  lightboxNumber = num;
  $("#lightbox-img").src = paintingUrl(num);
  $("#lightbox-img").alt = `Painting ${num}`;
  $("#lightbox-number").textContent = `Painting #${num} of 1000`;
  renderAnalysis(num);
  window.GalleryShop?.updateLightbox(window.GalleryShop.fromPainting(num));
}

function showLightboxAsset(item) {
  $("#lightbox-img").src = resolveGalleryUrl(item.url);
  $("#lightbox-img").alt = item.title || "Gallery asset";
  const label = item.subtitle ? `${item.title} · ${item.subtitle}` : item.title;
  $("#lightbox-number").textContent = label || "Gallery asset";
  if (item.collection === "generated" && item.number != null) {
    renderGeneratedAnalysis(item.number);
    window.GalleryShop?.updateLightbox(window.GalleryShop.fromAsset(item));
    return;
  }
  if (
    (item.collection === "sketches" || item.collection === "sketches-inverted") &&
    item.number != null
  ) {
    renderSketchAnalysis(item.number);
    window.GalleryShop?.updateLightbox(window.GalleryShop.fromAsset(item));
    return;
  }
  $("#analysis-body").innerHTML = `
    <h2>${escapeHtml(item.title || "Asset")}</h2>
    <p class="description">${escapeHtml(item.entity_name || "")}${item.version ? ` — iteration #${item.version}` : ""}</p>
  `;
  window.GalleryShop?.updateLightbox(window.GalleryShop.fromAsset(item));
}

function navigateLightbox(delta) {
  if (currentIndex == null) return;
  const idx = currentIndex + delta;
  if (idx < 0 || idx >= filtered.length) return;
  currentIndex = idx;
  const item = filtered[currentIndex];
  if (galleryCollection === "paintings") {
    lightboxSource = "painting";
    lightboxNumber = item.number;
    lightboxAssetId = null;
    showLightboxPainting(item.number);
  } else {
    lightboxAssetId = item.id;
    lightboxNumber = item.number ?? null;
    lightboxSource =
      item.collection === "generated"
        ? "generated"
        : item.collection === "sketches"
          ? "sketch"
          : "asset";
    showLightboxAsset(item);
  }
}

function bindEvents() {
  $("#search").addEventListener("input", debounce(() => applyFilters(), 200));
  $("#filter-style").addEventListener("change", () => applyFilters());
  $("#sort").addEventListener("change", () => applyFilters());
  $("#only-analyzed").addEventListener("change", () => applyFilters());
  $("#gallery-collections")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".gallery-collection");
    if (!btn?.dataset.collection) return;
    setGalleryCollection(btn.dataset.collection);
  });
  $("#load-more").addEventListener("click", () => {
    if (visibleCount >= filtered.length) return;
    visibleCount = Math.min(visibleCount + PAGE_SIZE, filtered.length);
    appendMoreCards();
  });

  $("#lightbox-close").addEventListener("click", () => {
    if (window.galleryDialog) window.galleryDialog.close($("#lightbox"));
    else $("#lightbox").close();
  });

  $("#lightbox-prev").addEventListener("click", () => navigateLightbox(-1));
  $("#lightbox-next").addEventListener("click", () => navigateLightbox(1));

  $("#lightbox").addEventListener("click", (e) => {
    if (e.target === $("#lightbox")) {
      if (window.galleryDialog) window.galleryDialog.close($("#lightbox"));
      else $("#lightbox").close();
    }
  });

  $("#lightbox").addEventListener("close", () => {
    stopLightboxPoll();
    lightboxNumber = null;
    lightboxAssetId = null;
    refreshAnalyses({ force: true });
  });

  document.addEventListener("keydown", (e) => {
    if (!$("#lightbox").open) return;
    if (e.key === "Escape") {
      if (window.galleryDialog) window.galleryDialog.close($("#lightbox"));
      else $("#lightbox").close();
    }
    if (e.key === "ArrowLeft") navigateLightbox(-1);
    if (e.key === "ArrowRight") navigateLightbox(1);
  });

  $("#use-as-spell")?.addEventListener("click", () => {
    if (lightboxNumber == null && lightboxSource !== "sketch") return;
    if (lightboxNumber == null) return;
    if (window.galleryDialog) window.galleryDialog.close($("#lightbox"));
    else $("#lightbox").close();
    location.hash = "spellforge";
    document.querySelector('.site-tabs .tab[data-tab="spellforge"]')?.click();
    const detail = { number: lightboxNumber };
    if (lightboxSource === "sketch") {
      // Spellforge arsenal IDs for sketches: SKETCH_BASE (200000) + S#
      detail.number = 200000 + lightboxNumber;
      detail.source = "sketch";
      detail.sketchNum = lightboxNumber;
      detail.url = sketchUrl(lightboxNumber);
    } else if (lightboxSource === "generated") {
      detail.number = 100000 + lightboxNumber;
      detail.source = "generated";
      detail.genNum = lightboxNumber;
    }
    window.dispatchEvent(new CustomEvent("spellforge-equip", { detail }));
  });

  $("#lightbox-tabloid-print")?.addEventListener("click", () => {
    if (lightboxNumber == null || !window.TabloidPrint) return;
    const img = $("#lightbox-img");
    if (!img?.src) return;
    const a = getAnalysis(lightboxNumber);
    window.TabloidPrint.prepare({
      image: img,
      title: a?.title || `Painting ${lightboxNumber}`,
      subtitle: `Painting #${lightboxNumber} of 1000`,
      caption: a?.description || "",
      source: "Gallery",
      filename: `painting-${lightboxNumber}`,
    });
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function refreshAnalyses(options = {}) {
  if ($("#lightbox").open && !options.force) return;

  const res = await fetch(`${ANALYSES_URL}?t=${Date.now()}`);
  if (!res.ok) return;

  analyses = await res.json();
  const analyzedNow = countAnalyzed();
  if (analyzedNow === lastAnalyzedCount && !options.force) return;
  lastAnalyzedCount = analyzedNow;

  updateStats();
  populateStyleFilter();
  patchVisibleCards();
}

/**
 * Jump to a painting or generated still from other tabs (Dream Stasis, etc.).
 * @param {number|string} num
 * @param {{collection?: string}} [opts]
 */
async function galleryJumpToNumber(num, opts) {
  opts = opts || {};
  const n = parseInt(num, 10);
  if (!n || n < 1) return false;
  const collection = opts.collection || "generated";

  const tab = document.querySelector('.site-tabs .tab[data-tab="gallery"]');
  if (tab) tab.click();

  if (collection === "paintings") {
    if (n > 1000) return false;
    await setGalleryCollection("paintings");
    openLightbox(n);
    const card = document.querySelector(`#gallery .card[data-number="${n}"]`);
    if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return true;
  }

  await setGalleryCollection("generated");
  await loadLod1Data();
  let item = (assetItems || []).find((it) => Number(it.number) === n);
  if (!item) {
    item = {
      id: `generated/${n}`,
      url: generatedUrl(n),
      title: `Generated #${n}`,
      subtitle: `G#${n}`,
      version: n,
      collection: "generated",
      number: n,
      entity_name: `G#${n}`,
    };
  }
  openAssetLightbox(item);
  const card = document.querySelector(`#gallery .card-generated[data-number="${n}"]`);
  if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return true;
}

window.GalleryJump = {
  toGenerated: (num) => galleryJumpToNumber(num, { collection: "generated" }),
  toPainting: (num) => galleryJumpToNumber(num, { collection: "paintings" }),
  toNumber: galleryJumpToNumber,
};

let galleryDataReady = null;

function activeTabName() {
  try {
    const bodyTab = document.body && document.body.getAttribute("data-active-tab");
    if (bodyTab) return bodyTab;
    const h = (location.hash || "").replace(/^#/, "").split("?")[0];
    return h || "gallery";
  } catch (e) {
    return "gallery";
  }
}

/** Paintings manifest + analyses only — never pull Generated analyses on boot. */
async function ensureGalleryData() {
  if (galleryDataReady) return galleryDataReady;
  galleryDataReady = (async () => {
    const grid = $("#gallery");
    if (grid && !manifest.length) {
      grid.innerHTML = `<p class="empty-state">Loading gallery…</p>`;
    }
    await loadData();
    // Yield so tab clicks are not stuck behind filter/render
    await new Promise((r) => setTimeout(r, 0));
    filtered = [...manifest];
    updateStats();
    populateStyleFilter();
    applyFilters();
    return true;
  })().catch((err) => {
    galleryDataReady = null;
    throw err;
  });
  return galleryDataReady;
}

async function init() {
  bindEvents();

  const tab = activeTabName();
  // Only block first paint when Gallery is the active tab
  const needsGalleryNow = tab === "gallery" || tab === "";

  if (needsGalleryNow) {
    // Don't await forever — keep UI responsive if JSON is slow
    ensureGalleryData().catch((err) => {
      console.error(err);
      const grid = $("#gallery");
      if (grid) {
        grid.innerHTML = `<p class="empty-state">Failed to load gallery data. Is the server running?</p>`;
      }
    });
  } else {
    const warm = () => {
      ensureGalleryData().catch((err) => console.warn("gallery warm load", err));
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(warm, { timeout: 6000 });
    } else {
      setTimeout(warm, 1500);
    }
  }

  if (IS_LOCAL) {
    setInterval(() => {
      if (activeTabName() !== "gallery") return;
      if (countAnalyzed() < manifest.length) refreshAnalyses();
    }, REFRESH_MS);
  }
  if (CAN_USE_GALLERY_API) {
    setInterval(() => {
      if (activeTabName() !== "gallery") return;
      if (galleryCollection === "generated") {
        // Only refresh if already loaded once (avoid surprise 4MB download)
        if (Object.keys(lod1Analyses).length) {
          loadLod1Analyses().then(() => {
            patchAssetCards();
            updateCollectionChrome();
          });
        }
      } else if (galleryCollection !== "paintings") {
        refreshActiveCollection({ preserveView: true });
      }
    }, LOD1_REFRESH_MS);
  }
}

// Load when user opens Gallery tab
window.addEventListener("tab-changed", (e) => {
  const tab = (e.detail && e.detail.tab) || "";
  if (tab === "gallery") {
    ensureGalleryData().catch((err) => {
      console.error(err);
      const grid = $("#gallery");
      if (grid) {
        grid.innerHTML = `<p class="empty-state">Failed to load gallery data. Is the server running?</p>`;
      }
    });
  }
});

init().catch((err) => {
  console.error(err);
  if (activeTabName() === "gallery") {
    const grid = $("#gallery");
    if (grid) {
      grid.innerHTML = `<p class="empty-state">Failed to load gallery data. Is the server running?</p>`;
    }
  }
});