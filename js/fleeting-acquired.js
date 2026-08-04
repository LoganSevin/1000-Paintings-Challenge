/**
 * Fleeting Idea — image rail: 1000 paintings, saved/generated folders, uploads, 5 slots.
 */
(function () {
  var SLOT_COUNT = 5;
  var SLOTS_KEY = "fleeting_idea_slots_v1";
  var ACTIVE_SLOT_KEY = "fleeting_active_slot_v1";
  var UPLOAD_DB = "fleeting_uploads_v1";
  var UPLOAD_STORE = "files";
  var GENERATED_ID = "generated";
  var LOD1_SOURCE_ID = "lod1s";
  var LOD1_MANIFEST_URL = "data/lod1-manifest.json";
  var SAVED_STASIS_ID = "saved-stasis";
  var GENERATED_POLL_MS = 5000;
  var SAVED_STASIS_POLL_MS = 8000;
  var COMPASS_TEXTURE_ORDER = [
    { key: "n", folder: "saved-fallout/north", angle: 0 },
    { key: "ne", folder: "saved-fallout/northeast", angle: Math.PI / 4 },
    { key: "e", folder: "saved-fallout/east", angle: Math.PI / 2 },
    { key: "se", folder: "saved-fallout/southeast", angle: (3 * Math.PI) / 4 },
    { key: "s", folder: "saved-fallout/south", angle: Math.PI },
    { key: "sw", folder: "saved-fallout/southwest", angle: (5 * Math.PI) / 4 },
    { key: "w", folder: "saved-fallout/west", angle: (3 * Math.PI) / 2 },
    { key: "nw", folder: "saved-fallout/northwest", angle: (7 * Math.PI) / 4 },
  ];

  var state = {
    slots: [],
    activeSlot: 0,
    folderIndex: null,
    folderCache: {},
    uploads: [],
    paintings: [],
    lod1s: [],
    sessionItems: [],
    loadingFolder: {},
    generatedWatch: { count: -1, latestMtime: -1 },
    stasisWatch: { count: -1, latestMtime: -1 },
    generatedPollTimer: 0,
    stasisPollTimer: 0,
    tabActive: false,
    compassTextures: [],
    libraryFilter: "all",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function isLocalServer() {
    var h = (location.hostname || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function loadSlots() {
    try {
      var raw = localStorage.getItem(SLOTS_KEY);
      if (!raw) return emptySlots();
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length !== SLOT_COUNT) return emptySlots();
      return parsed;
    } catch (err) {
      return emptySlots();
    }
  }

  function emptySlots() {
    var out = [];
    for (var i = 0; i < SLOT_COUNT; i++) {
      out.push(emptySlot());
    }
    return out;
  }

  function emptySlot() {
    return {
      source: "",
      url: "",
      label: "",
      folderId: "",
      fileIndex: -1,
      paintingNum: null,
      lod1Num: null,
      uploadId: null,
    };
  }

  function isLod1Item(item) {
    if (!item) return false;
    return (
      item.source === "lod1" ||
      item.folderId === GENERATED_ID ||
      item.folderId === LOD1_SOURCE_ID ||
      (item.url && String(item.url).indexOf("/generated/") >= 0)
    );
  }

  function saveSlots() {
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(state.slots));
      localStorage.setItem(ACTIVE_SLOT_KEY, String(state.activeSlot));
    } catch (err) {}
  }

  function loadActiveSlot() {
    var n = parseInt(localStorage.getItem(ACTIVE_SLOT_KEY) || "0", 10);
    return isNaN(n) || n < 0 || n >= SLOT_COUNT ? 0 : n;
  }

  function openUploadDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = indexedDB.open(UPLOAD_DB, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(UPLOAD_STORE, { keyPath: "id" });
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("Could not open uploads DB"));
      };
    });
  }

  function listUploads() {
    return openUploadDb()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(UPLOAD_STORE, "readonly");
          var req = tx.objectStore(UPLOAD_STORE).getAll();
          req.onsuccess = function () {
            var rows = req.result || [];
            rows.sort(function (a, b) {
              return (b.created || 0) - (a.created || 0);
            });
            resolve(rows);
          };
          req.onerror = function () {
            reject(req.error);
          };
        });
      })
      .catch(function () {
        return [];
      });
  }

  function preprocessUploadFile(file) {
    if (!file || !file.type || file.type.indexOf("image/") !== 0) {
      return Promise.resolve(file);
    }
    if (file.size < 900000 && !/image\/(jpeg|jpg|webp)/i.test(file.type)) {
      return Promise.resolve(file);
    }
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var maxDim = 2048;
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          function (blob) {
            if (!blob) {
              resolve(file);
              return;
            }
            resolve(
              new File([blob], (file.name || "upload").replace(/\.\w+$/, ".jpg"), {
                type: "image/jpeg",
                lastModified: Date.now(),
              })
            );
          },
          "image/jpeg",
          0.86
        );
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  function putUpload(file) {
    var id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "up-" + Date.now();
    return preprocessUploadFile(file).then(function (optimized) {
      var row = {
        id: id,
        name: optimized.name || file.name || "upload",
        mime: optimized.type || file.type || "image/jpeg",
        created: Date.now(),
        blob: optimized,
      };
      row._url = URL.createObjectURL(optimized);
      state.uploads.unshift(row);
      state.folderCache["uploads/mine"] = null;
      renderSources();
      return openUploadDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(UPLOAD_STORE, "readwrite");
          tx.objectStore(UPLOAD_STORE).put(row);
          tx.oncomplete = function () {
            resolve(row);
          };
          tx.onerror = function () {
            reject(tx.error);
          };
        });
      });
    });
  }

  function restoreSlotUrls() {
    state.slots.forEach(function (slot) {
      if (!slot.uploadId || slot.url) return;
      var row = state.uploads.find(function (u) {
        return u.id === slot.uploadId;
      });
      if (row) slot.url = uploadObjectUrl(row);
    });
  }

  function deleteUpload(id) {
    return openUploadDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(UPLOAD_STORE, "readwrite");
        tx.objectStore(UPLOAD_STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function uploadObjectUrl(row) {
    if (!row || !row.blob) return "";
    if (!row._url) row._url = URL.createObjectURL(row.blob);
    return row._url;
  }

  function buildSessionItems() {
    var items = [];
    var sf = window.spellforgeFusion;
    if (sf && sf.visionUrl) {
      items.push({
        source: "session",
        url: sf.visionUrl,
        label: "Spellforge stasis vision",
        folderId: "session/spellforge",
        fileIndex: 0,
      });
    }
    return items;
  }

  function shuffleArray(arr) {
    var a = arr.slice();
    var i = a.length;
    while (i > 1) {
      var j = Math.floor(Math.random() * i--);
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function paintingPayload(p) {
    return {
      source: "painting",
      url: p.url,
      label: p.label,
      folderId: "paintings/all",
      paintingNum: p.num,
      fileIndex: state.paintings.indexOf(p),
    };
  }

  function randomizeActiveSlot() {
    return loadPaintings().then(function () {
      if (!state.paintings.length) return false;
      var pick = state.paintings[Math.floor(Math.random() * state.paintings.length)];
      equipSlot(state.activeSlot, paintingPayload(pick));
      return true;
    });
  }

  function randomizeAllSlots() {
    return loadPaintings().then(function () {
      if (!state.paintings.length) return false;
      var picks = shuffleArray(state.paintings).slice(0, SLOT_COUNT);
      for (var i = 0; i < SLOT_COUNT; i++) {
        if (i < picks.length) equipSlot(i, paintingPayload(picks[i]));
        else clearSlot(i);
      }
      setActiveSlot(0);
      return true;
    });
  }

  function loadPaintings() {
    if (window.getGalleryManifest && window.getGalleryManifest().length) {
      state.paintings = window.getGalleryManifest()
        .map(function (m) {
          return {
            num: m.number,
            url: window.getPaintingUrl(m.number),
            label: "#" + m.number,
          };
        })
        .sort(function (a, b) {
          return a.num - b.num;
        });
      return Promise.resolve(state.paintings);
    }
    if (!window.loadGalleryData) return Promise.resolve([]);
    return window.loadGalleryData().then(function () {
      state.paintings = (window.getGalleryManifest() || [])
        .map(function (m) {
          return {
            num: m.number,
            url: window.getPaintingUrl(m.number),
            label: "#" + m.number,
          };
        })
        .sort(function (a, b) {
          return a.num - b.num;
        });
      return state.paintings;
    });
  }

  function fetchFolderIndex() {
    if (!isLocalServer()) {
      return Promise.resolve({ ok: false, folders: [] });
    }
    return fetch("/api/acquired-images")
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return { ok: false, folders: [] };
      });
  }

  function folderCacheKey(folderId) {
    return folderId === LOD1_SOURCE_ID ? GENERATED_ID : folderId;
  }

  function loadLod1Manifest() {
    return fetch(LOD1_MANIFEST_URL)
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.items) || !data.items.length) {
          return state.lod1s;
        }
        state.lod1s = data.items
          .map(function (item) {
            return {
              num: item.num,
              url: item.url,
              name: item.name || String(item.num) + ".jpg",
              label: "LOD1 #" + item.num,
            };
          })
          .sort(function (a, b) {
            return b.num - a.num;
          });
        syncLod1Cache();
        return state.lod1s;
      })
      .catch(function () {
        return state.lod1s;
      });
  }

  function syncLod1Cache(files) {
    if (files && files.length) {
      state.folderCache[GENERATED_ID] = files;
      state.generatedWatch.count = files.length;
      state.generatedWatch.latestMtime = files[0].mtime || files[0].num || 0;
      return;
    }
    var out = (state.lod1s || []).map(function (item) {
      return {
        name: item.name,
        url: item.url,
        num: item.num,
        mtime: item.num,
      };
    });
    state.folderCache[GENERATED_ID] = out;
    state.generatedWatch.count = out.length;
    state.generatedWatch.latestMtime = out.length ? out[0].num : 0;
  }

  function fetchFolderFiles(folderId, force) {
    var cacheKey = folderCacheKey(folderId);
    if (!force && state.folderCache[cacheKey] && state.folderCache[cacheKey].length) {
      return Promise.resolve(state.folderCache[cacheKey]);
    }
    if (cacheKey === GENERATED_ID) {
      var manifestReady = state.lod1s.length
        ? Promise.resolve(state.lod1s)
        : loadLod1Manifest();
      if (!isLocalServer()) {
        return manifestReady.then(function () {
          return state.folderCache[GENERATED_ID] || [];
        });
      }
      return fetch(
        "/api/acquired-images?folder=" + encodeURIComponent(LOD1_SOURCE_ID)
      )
        .then(function (r) {
          if (!r.ok) throw new Error("LOD1 API unavailable");
          return r.json();
        })
        .then(function (data) {
          var files = (data && data.files) || [];
          if (files.length) {
            state.folderCache[GENERATED_ID] = files;
            state.generatedWatch.count = files.length;
            state.generatedWatch.latestMtime = files[0].mtime || 0;
            return files;
          }
          return manifestReady.then(function () {
            return state.folderCache[GENERATED_ID] || [];
          });
        })
        .catch(function () {
          return manifestReady.then(function () {
            return state.folderCache[GENERATED_ID] || [];
          });
        });
    }
    if (!isLocalServer()) return Promise.resolve([]);
    return fetch("/api/acquired-images?folder=" + encodeURIComponent(folderId))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var files = (data && data.files) || [];
        state.folderCache[cacheKey] = files;
        return files;
      })
      .catch(function () {
        return [];
      });
  }

  function syncGeneratedCache(files) {
    syncLod1Cache(files || []);
  }

  function syncStasisCache(files) {
    state.folderCache[SAVED_STASIS_ID] = files || [];
    if (files && files.length) {
      state.stasisWatch.count = files.length;
      state.stasisWatch.latestMtime = files[0].mtime || 0;
    } else {
      state.stasisWatch.count = 0;
      state.stasisWatch.latestMtime = 0;
    }
  }

  function updateFolderSummary(folderId, count, suffix) {
    var details = document.getElementById(sourceDomId(folderId));
    if (!details) return;
    var countEl = details.querySelector(".fi-source-count");
    if (countEl) countEl.textContent = count + " images" + (suffix ? " · " + suffix : "");
    var folder = (state.folderIndex && state.folderIndex.folders) || [];
    folder.forEach(function (f) {
      if (f.id === folderId) f.count = count;
    });
  }

  function updateLod1Summary(count) {
    updateFolderSummary(LOD1_SOURCE_ID, count, "gallery/generated");
  }

  function updateGeneratedSummary(count) {
    updateLod1Summary(count);
  }

  function updateStasisSummary(count) {
    updateFolderSummary(SAVED_STASIS_ID, count, "in library");
  }

  function indexedFolderCount(folderId) {
    if (folderId === GENERATED_ID || folderId === LOD1_SOURCE_ID) {
      if (state.lod1s.length) return state.lod1s.length;
      var cachedLod1 = state.folderCache[GENERATED_ID];
      if (cachedLod1 && cachedLod1.length) return cachedLod1.length;
    }
    if (!state.folderIndex || !state.folderIndex.ok) {
      var cached = state.folderCache[folderCacheKey(folderId)];
      return cached ? cached.length : 0;
    }
    var folders = state.folderIndex.folders || [];
    for (var i = 0; i < folders.length; i++) {
      if (folders[i].id === folderId || (folderId === GENERATED_ID && folders[i].id === LOD1_SOURCE_ID)) {
        return folders[i].count || 0;
      }
    }
    return 0;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Could not load image."));
      };
      img.src = url;
    });
  }

  function compassKeyForFolder(folderId) {
    var match = COMPASS_TEXTURE_ORDER.find(function (c) {
      return c.folder === folderId;
    });
    return match ? match.key : "";
  }

  function pushCompassTextures(textures) {
    state.compassTextures = textures || [];
    if (window.FleetingWalk && window.FleetingWalk.setCompassTextures) {
      window.FleetingWalk.setCompassTextures(state.compassTextures);
    }
  }

  function loadCompassTextures(force) {
    if (!isLocalServer()) {
      pushCompassTextures([]);
      return Promise.resolve([]);
    }
    var jobs = COMPASS_TEXTURE_ORDER.map(function (compass) {
      return fetchFolderFiles(compass.folder, !!force).then(function (files) {
        var entry = {
          key: compass.key,
          folder: compass.folder,
          angle: compass.angle,
          img: null,
          url: "",
        };
        if (!files.length || !files[0].url) return entry;
        entry.url = files[0].url;
        return loadImage(files[0].url)
          .then(function (img) {
            entry.img = img;
            return entry;
          })
          .catch(function () {
            return entry;
          });
      });
    });
    return Promise.all(jobs).then(function (textures) {
      pushCompassTextures(textures);
      return textures;
    });
  }

  function notifyCompassTextureFromPick(item, folderId) {
    var key = compassKeyForFolder(folderId);
    if (!key || !item || !item.url) return;
    loadImage(item.url)
      .then(function (img) {
        var existing = state.compassTextures.find(function (t) {
          return t.key === key;
        });
        if (existing) {
          existing.img = img;
          existing.url = item.url;
        } else {
          var compass = COMPASS_TEXTURE_ORDER.find(function (c) {
            return c.key === key;
          });
          state.compassTextures.push({
            key: key,
            folder: folderId,
            angle: compass ? compass.angle : 0,
            img: img,
            url: item.url,
          });
        }
        if (window.FleetingWalk && window.FleetingWalk.setCompassTexture) {
          window.FleetingWalk.setCompassTexture(key, img, item.url);
        }
      })
      .catch(function () {});
  }

  function afterSlotEquip(slot) {
    if (window.FleetingWalk && window.FleetingWalk.setVision && slot && slot.url) {
      window.FleetingWalk.setVision(slot.url).catch(function () {});
    }
    window.dispatchEvent(
      new CustomEvent("fi-slots-changed", { detail: { slots: state.slots.slice() } })
    );
  }

  function equipSlot(index, item) {
    if (index < 0 || index >= SLOT_COUNT) return;
    var lod1 = isLod1Item(item);
    state.slots[index] = {
      source: item.source || "file",
      url: item.url || "",
      label: item.label || "",
      folderId: item.folderId || "",
      fileIndex: item.fileIndex == null ? -1 : item.fileIndex,
      paintingNum: lod1 ? null : item.paintingNum || item.num || null,
      lod1Num: lod1 ? item.lod1Num || item.num || null : null,
      uploadId: item.uploadId || null,
    };
    saveSlots();
    renderSlots();
    afterSlotEquip(state.slots[index]);
  }

  function clearSlot(index) {
    equipSlot(index, emptySlot());
  }

  function cycleSlot(index, dir) {
    var slot = state.slots[index];
    if (!slot || !slot.folderId) return;
    var files = state.folderCache[folderCacheKey(slot.folderId)];
    if (!files || !files.length) {
      fetchFolderFiles(slot.folderId).then(function (loaded) {
        if (!loaded.length) return;
        cycleSlot(index, dir);
      });
      return;
    }
    var next = slot.fileIndex + dir;
    if (next < 0) next = files.length - 1;
    if (next >= files.length) next = 0;
    var file = files[next];
    if (!file || !file.url) return;
    var lod1 = slot.folderId === GENERATED_ID || slot.folderId === LOD1_SOURCE_ID || slot.source === "lod1";
    equipSlot(index, {
      source: lod1 ? "lod1" : slot.source,
      url: file.url,
      label: file.name || slot.label,
      folderId: slot.folderId,
      fileIndex: next,
      paintingNum: lod1 ? null : file.num || slot.paintingNum,
      lod1Num: lod1 ? file.num || null : null,
      uploadId: slot.uploadId,
    });
  }

  function setActiveSlot(index) {
    state.activeSlot = index;
    saveSlots();
    renderSlots();
  }

  function renderSlots() {
    var wrap = $("fi-slots");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (var i = 0; i < SLOT_COUNT; i++) {
      (function (idx) {
        var slot = state.slots[idx] || emptySlot();
        var card = document.createElement("div");
        card.className = "fi-slot" + (state.activeSlot === idx ? " active" : "");
        card.dataset.slot = String(idx);

        var head = document.createElement("div");
        head.className = "fi-slot-head";
        head.innerHTML =
          '<span class="fi-slot-label">Image ' +
          (idx + 1) +
          "</span>" +
          '<button type="button" class="fi-slot-clear" data-slot="' +
          idx +
          '" title="Clear slot">×</button>';

        var frame = document.createElement("button");
        frame.type = "button";
        frame.className = "fi-slot-frame";
        frame.title = slot.label || "Click to select, then pick from the rail";
        if (slot.url) {
          frame.innerHTML =
            '<img src="' +
            escapeAttr(slot.url) +
            '" alt="" loading="lazy" />' +
            '<span class="fi-slot-caption">' +
            escapeAttr(slot.label || "") +
            "</span>";
        } else {
          frame.innerHTML = '<span class="fi-slot-empty">+</span>';
        }
        frame.addEventListener("click", function () {
          setActiveSlot(idx);
        });

        var nav = document.createElement("div");
        nav.className = "fi-slot-nav";
        nav.innerHTML =
          '<button type="button" class="fi-slot-cycle" data-dir="-1" data-slot="' +
          idx +
          '" title="Previous in folder">‹</button>' +
          '<button type="button" class="fi-slot-cycle" data-dir="1" data-slot="' +
          idx +
          '" title="Next in folder">›</button>';

        card.appendChild(head);
        card.appendChild(frame);
        card.appendChild(nav);
        wrap.appendChild(card);
      })(i);
    }

    wrap.querySelectorAll(".fi-slot-clear").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        clearSlot(parseInt(btn.dataset.slot, 10));
      });
    });
    wrap.querySelectorAll(".fi-slot-cycle").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        cycleSlot(parseInt(btn.dataset.slot, 10), parseInt(btn.dataset.dir, 10));
      });
    });
  }

  function matchesSearch(text, q) {
    if (!q) return true;
    return String(text || "")
      .toLowerCase()
      .indexOf(q) >= 0;
  }

  function getSearchQuery() {
    var el = $("fi-acquired-search");
    return el ? el.value.trim().toLowerCase() : "";
  }

  function renderThumbGrid(container, items, onPick) {
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = '<p class="fi-acquired-empty">No images in this folder.</p>';
      return;
    }
    var grid = document.createElement("div");
    grid.className = "fi-acquired-grid";
    items.forEach(function (item, index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fi-acquired-thumb";
      btn.title = item.label || item.name || "";
      btn.innerHTML =
        '<img src="' +
        escapeAttr(item.url) +
        '" alt="" loading="lazy" width="64" height="64" />';
      btn.addEventListener("click", function () {
        onPick(item, index);
      });
      grid.appendChild(btn);
    });
    container.appendChild(grid);
  }

  function pickItem(item, index) {
    var folderId = item.folderId || "";
    var lod1 = isLod1Item(item);
    var payload = {
      source: item.source || "file",
      url: item.url,
      label: item.label || item.name || "",
      folderId: folderId,
      fileIndex: index == null ? -1 : index,
      paintingNum: lod1 ? null : item.paintingNum || item.num || null,
      lod1Num: lod1 ? item.lod1Num || item.num || null : null,
      uploadId: item.uploadId || null,
    };
    equipSlot(state.activeSlot, payload);
  }

  function renderFolderToolsSection(bodyEl, opts) {
    bodyEl.innerHTML = '<p class="fi-acquired-loading">Loading ' + escapeAttr(opts.loadingLabel) + "…</p>";
    return fetchFolderFiles(opts.folderId, true)
      .then(function (files) {
        opts.syncCache(files);
        opts.updateSummary(files.length);
        var q = getSearchQuery();
        var list = files
          .filter(function (f) {
            return f.url && matchesSearch(f.name, q);
          })
          .map(function (f) {
            return {
              source: opts.source,
              url: f.url,
              label: f.name,
              name: f.name,
              folderId: opts.folderId,
            };
          });

        bodyEl.innerHTML = "";
        var tools = document.createElement("div");
        tools.className = "fi-generated-tools";
        tools.innerHTML =
          '<p class="fi-generated-hint">' + escapeAttr(opts.hint) + "</p>";
        var latestBtn = document.createElement("button");
        latestBtn.type = "button";
        latestBtn.className = "fi-toolbar-btn";
        latestBtn.textContent = opts.latestLabel;
        latestBtn.disabled = !files.length;
        latestBtn.addEventListener("click", function () {
          opts.equipLatest();
        });
        tools.appendChild(latestBtn);
        bodyEl.appendChild(tools);

        renderThumbGrid(bodyEl, list, function (item) {
          var realIndex = files.findIndex(function (f) {
            return f.url === item.url;
          });
          var idx = realIndex >= 0 ? realIndex : 0;
          pickItem(item, idx);
          if (opts.onPick) opts.onPick(item, idx);
        });
      })
      .catch(function () {
        bodyEl.innerHTML =
          '<p class="fi-acquired-empty">Could not load ' + escapeAttr(opts.loadingLabel) + ".</p>";
      });
  }

  function renderLod1Section(bodyEl) {
    var files = state.folderCache[GENERATED_ID] || [];
    var q = getSearchQuery();
    var list = (state.lod1s || []).filter(function (item) {
      return (
        matchesSearch(String(item.num), q) ||
        matchesSearch(item.name, q) ||
        matchesSearch(item.label, q)
      );
    });

    bodyEl.innerHTML = "";
    var tools = document.createElement("div");
    tools.className = "fi-generated-tools";
    tools.innerHTML =
      '<p class="fi-generated-hint">Same as painting spells — click to equip · ‹ › cycles LOD1s · numbered 1–' +
      (state.lod1s.length || "?") +
      " in gallery/generated.</p>";
    var latestBtn = document.createElement("button");
    latestBtn.type = "button";
    latestBtn.className = "fi-toolbar-btn";
    latestBtn.textContent = "Equip latest LOD1";
    latestBtn.disabled = !list.length;
    latestBtn.addEventListener("click", function () {
      equipLatestLod1();
    });
    tools.appendChild(latestBtn);
    bodyEl.appendChild(tools);

    if (!list.length) {
      bodyEl.innerHTML +=
        '<p class="fi-acquired-empty">No LOD1s found — run renumber_generated.py or refresh when the server is up.</p>';
      return;
    }

    renderThumbGrid(bodyEl, list, function (item) {
      var realIndex = files.findIndex(function (f) {
        return f.url === item.url;
      });
      pickItem(
        {
          source: "lod1",
          url: item.url,
          label: item.label,
          name: item.name,
          folderId: GENERATED_ID,
          num: item.num,
        },
        realIndex >= 0 ? realIndex : 0
      );
    });
  }

  function renderGeneratedSection(bodyEl) {
    if (state.lod1s.length) {
      renderLod1Section(bodyEl);
      return;
    }
    loadLod1Manifest().then(function () {
      renderLod1Section(bodyEl);
    });
  }

  function renderSavedStasisSection(bodyEl) {
    renderFolderToolsSection(bodyEl, {
      folderId: SAVED_STASIS_ID,
      source: "stasis",
      loadingLabel: "saved stasis",
      hint:
        "gallery/saved-stasis — center saves from Muralwalk · click to equip · ‹ › cycles this folder.",
      latestLabel: "Equip latest stasis",
      syncCache: syncStasisCache,
      updateSummary: updateStasisSummary,
      equipLatest: equipLatestStasis,
    });
  }

  function refreshLod1SectionOnly() {
    return fetchFolderFiles(GENERATED_ID, true).then(function (files) {
      if (!files.length && state.lod1s.length) syncLod1Cache();
      else syncGeneratedCache(files);
      updateLod1Summary(state.folderCache[GENERATED_ID].length || state.lod1s.length);
      var details = document.getElementById(sourceDomId(LOD1_SOURCE_ID));
      if (details && details.open) {
        var body = details.querySelector(".fi-source-body");
        if (body) renderLod1Section(body);
      }
    });
  }

  function refreshGeneratedSectionOnly() {
    return refreshLod1SectionOnly();
  }

  function equipLatestLod1() {
    var work = state.lod1s.length
      ? Promise.resolve(state.lod1s)
      : loadLod1Manifest();
    return work.then(function () {
      if (!state.lod1s.length) return;
      syncLod1Cache();
      var latest = state.lod1s[0];
      pickItem(
        {
          source: "lod1",
          url: latest.url,
          label: latest.label,
          name: latest.name,
          folderId: GENERATED_ID,
          num: latest.num,
        },
        0
      );
      scrollToSource(LOD1_SOURCE_ID);
    });
  }

  function equipLatestGenerated() {
    return equipLatestLod1();
  }

  function equipLatestStasis() {
    return fetchFolderFiles(SAVED_STASIS_ID, true).then(function (files) {
      if (!files.length) return;
      syncStasisCache(files);
      pickItem(
        {
          source: "stasis",
          url: files[0].url,
          label: files[0].name,
          name: files[0].name,
          folderId: SAVED_STASIS_ID,
        },
        0
      );
      scrollToSource(SAVED_STASIS_ID);
    });
  }

  function refreshSavedStasisSectionOnly() {
    if (!isLocalServer()) return Promise.resolve();
    return fetchFolderFiles(SAVED_STASIS_ID, true).then(function (files) {
      syncStasisCache(files);
      updateStasisSummary(files.length);
      var details = document.getElementById(sourceDomId(SAVED_STASIS_ID));
      if (details && details.open) {
        var body = details.querySelector(".fi-source-body");
        if (body) renderSavedStasisSection(body);
      }
    });
  }

  function pollGeneratedFolder() {
    if (!state.tabActive || !isLocalServer()) return;
    fetch("/api/acquired-images?folder=" + encodeURIComponent(LOD1_SOURCE_ID))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var files = (data && data.files) || [];
        var count = files.length;
        var latest = count && files[0].mtime ? files[0].mtime : 0;
        if (
          count === state.generatedWatch.count &&
          latest === state.generatedWatch.latestMtime
        ) {
          return;
        }
        state.folderCache[GENERATED_ID] = files;
        state.generatedWatch.count = count;
        state.generatedWatch.latestMtime = latest;
        updateGeneratedSummary(count);
        var details = document.getElementById(sourceDomId(LOD1_SOURCE_ID));
        if (details && details.open) {
          var body = details.querySelector(".fi-source-body");
          if (body) renderLod1Section(body);
        }
      })
      .catch(function () {});
  }

  function startGeneratedPoll() {
    stopGeneratedPoll();
    state.tabActive = true;
    pollGeneratedFolder();
    state.generatedPollTimer = window.setInterval(pollGeneratedFolder, GENERATED_POLL_MS);
  }

  function stopGeneratedPoll() {
    state.tabActive = false;
    if (state.generatedPollTimer) {
      clearInterval(state.generatedPollTimer);
      state.generatedPollTimer = 0;
    }
  }

  function pollSavedStasisFolder() {
    if (!state.tabActive || !isLocalServer()) return;
    fetch("/api/acquired-images?folder=" + encodeURIComponent(SAVED_STASIS_ID))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var files = (data && data.files) || [];
        var count = files.length;
        var latest = count && files[0].mtime ? files[0].mtime : 0;
        if (count === state.stasisWatch.count && latest === state.stasisWatch.latestMtime) {
          return;
        }
        state.folderCache[SAVED_STASIS_ID] = files;
        state.stasisWatch.count = count;
        state.stasisWatch.latestMtime = latest;
        updateStasisSummary(count);
        var details = document.getElementById(sourceDomId(SAVED_STASIS_ID));
        if (details && details.open) {
          var body = details.querySelector(".fi-source-body");
          if (body) renderSavedStasisSection(body);
        }
      })
      .catch(function () {});
  }

  function startSavedStasisPoll() {
    stopSavedStasisPoll();
    pollSavedStasisFolder();
    state.stasisPollTimer = window.setInterval(pollSavedStasisFolder, SAVED_STASIS_POLL_MS);
  }

  function stopSavedStasisPoll() {
    if (state.stasisPollTimer) {
      clearInterval(state.stasisPollTimer);
      state.stasisPollTimer = 0;
    }
  }

  function renderPaintingsSection(bodyEl) {
    var q = getSearchQuery();
    var list = state.paintings.filter(function (p) {
      return matchesSearch(String(p.num), q) || matchesSearch(p.label, q);
    });
    state.folderCache["paintings/all"] = list.map(function (p, i) {
      return { name: p.label, url: p.url, paintingNum: p.num };
    });
    renderThumbGrid(bodyEl, list, function (item, index) {
      pickItem(
        {
          source: "painting",
          url: item.url,
          label: item.label,
          folderId: "paintings/all",
          paintingNum: item.num,
        },
        index
      );
    });
  }

  function renderUploadsSection(bodyEl) {
    var q = getSearchQuery();
    var list = state.uploads
      .map(function (row) {
        return {
          source: "upload",
          url: uploadObjectUrl(row),
          label: row.name,
          folderId: "uploads/mine",
          uploadId: row.id,
        };
      })
      .filter(function (item) {
        return matchesSearch(item.label, q);
      });
    state.folderCache["uploads/mine"] = list.map(function (item) {
      return { name: item.label, url: item.url, uploadId: item.uploadId };
    });
    renderThumbGrid(bodyEl, list, function (item, index) {
      pickItem(item, index);
    });
  }

  function renderSessionSection(bodyEl) {
    state.sessionItems = buildSessionItems();
    renderThumbGrid(bodyEl, state.sessionItems, function (item, index) {
      pickItem(item, index);
    });
  }

  function renderFalloutSection(folderId, label, compassKey, bodyEl) {
    if (!bodyEl) return;
    if (state.loadingFolder[folderId]) {
      bodyEl.innerHTML = '<p class="fi-acquired-loading">Loading…</p>';
      return;
    }
    state.loadingFolder[folderId] = true;
    bodyEl.innerHTML = '<p class="fi-acquired-loading">Loading…</p>';
    fetchFolderFiles(folderId)
      .then(function (files) {
        state.loadingFolder[folderId] = false;
        var q = getSearchQuery();
        var list = files
          .filter(function (f) {
            return f.url && matchesSearch(f.name, q);
          })
          .map(function (f) {
            return {
              source: "fallout",
              url: f.url,
              label: f.name,
              name: f.name,
              folderId: folderId,
              compassKey: compassKey || compassKeyForFolder(folderId),
            };
          });
        renderThumbGrid(bodyEl, list, function (item, index) {
          var realIndex = files.findIndex(function (f) {
            return f.url === item.url;
          });
          var idx = realIndex >= 0 ? realIndex : index;
          pickItem(item, idx);
          notifyCompassTextureFromPick(item, folderId);
        });
      })
      .catch(function () {
        state.loadingFolder[folderId] = false;
        bodyEl.innerHTML = '<p class="fi-acquired-empty">Could not load folder.</p>';
      });
  }

  function renderFolderSection(folderId, label, bodyEl) {
    if (state.loadingFolder[folderId]) {
      bodyEl.innerHTML = '<p class="fi-acquired-loading">Loading…</p>';
      return;
    }
    state.loadingFolder[folderId] = true;
    bodyEl.innerHTML = '<p class="fi-acquired-loading">Loading…</p>';
    fetchFolderFiles(folderId)
      .then(function (files) {
        state.loadingFolder[folderId] = false;
        var q = getSearchQuery();
        var list = files
          .filter(function (f) {
            return f.url && matchesSearch(f.name, q);
          })
          .map(function (f, i) {
            return {
              source: "file",
              url: f.url,
              label: f.name,
              name: f.name,
              folderId: folderId,
            };
          });
        renderThumbGrid(bodyEl, list, function (item, index) {
          var realIndex = files.findIndex(function (f) {
            return f.url === item.url;
          });
          pickItem(item, realIndex >= 0 ? realIndex : index);
        });
      })
      .catch(function () {
        state.loadingFolder[folderId] = false;
        bodyEl.innerHTML = '<p class="fi-acquired-empty">Could not load folder.</p>';
      });
  }

  function sourceDomId(folderId) {
    return "fi-source-" + String(folderId || "").replace(/[\/\\]+/g, "-");
  }

  function sourceMatchesFilter(sourceId, filter) {
    if (!filter || filter === "all") return true;
    if (filter === "fallout") {
      return sourceId === "saved-fallout" || String(sourceId).indexOf("saved-fallout/") === 0;
    }
    if (filter === LOD1_SOURCE_ID) {
      return sourceId === LOD1_SOURCE_ID || sourceId === GENERATED_ID;
    }
    return sourceId === filter;
  }

  function applyLibraryFilter(filter) {
    state.libraryFilter = filter || "all";
    document.querySelectorAll(".fi-lib-filter").forEach(function (btn) {
      var active = btn.dataset.filter === state.libraryFilter;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    var root = $("fi-acquired-sources");
    if (!root) return;

    root.querySelectorAll("[data-source-id]").forEach(function (el) {
      var sourceId = el.dataset.sourceId || "";
      var show = sourceMatchesFilter(sourceId, state.libraryFilter);
      el.hidden = !show;
      if (show && el.tagName === "DETAILS") el.open = true;
    });

    root.querySelectorAll(".fi-source-group[data-source-id]").forEach(function (group) {
      var show = sourceMatchesFilter(group.dataset.sourceId, state.libraryFilter);
      group.hidden = !show;
      if (show) {
        group.querySelectorAll(".fi-source-block[data-source-id]").forEach(function (child) {
          child.hidden = false;
          child.open = true;
        });
      }
    });

    root.querySelectorAll(".fi-library-group").forEach(function (group) {
      if (state.libraryFilter === "all") {
        group.hidden = false;
        return;
      }
      if (state.libraryFilter === "fallout") {
        group.hidden = true;
        return;
      }
      group.hidden = false;
      group.querySelectorAll(".fi-source-block[data-source-id]").forEach(function (child) {
        var showChild = sourceMatchesFilter(child.dataset.sourceId, state.libraryFilter);
        child.hidden = !showChild;
        if (showChild) child.open = true;
      });
    });
  }

  function scrollToSource(sourceId) {
    if (!sourceId) return;
    applyLibraryFilter(sourceId === "saved-fallout" ? "fallout" : sourceId);
    var el = document.getElementById(sourceDomId(sourceId));
    if (!el && String(sourceId).indexOf("saved-fallout/") === 0) {
      el = document.querySelector('[data-source-id="' + sourceId + '"]');
    }
    if (!el) return;
    if (el.tagName === "DETAILS") {
      el.open = true;
      var body = el.querySelector(".fi-source-body");
      if (body && !body.dataset.loaded) {
        body.dataset.loaded = "1";
        el.dispatchEvent(new Event("toggle"));
      }
    }
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function jumpToFolder(folderId) {
    scrollToSource(folderId);
  }

  function makeSourceBlock(id, title, countText, renderBody, startOpen) {
    var details = document.createElement("details");
    details.className = "fi-source-block";
    details.open = !!startOpen;
    if (id) {
      details.dataset.sourceId = id;
      details.id = sourceDomId(id);
    }

    var summary = document.createElement("summary");
    summary.className = "fi-source-summary";
    summary.innerHTML =
      '<span class="fi-source-title">' +
      escapeAttr(title) +
      "</span>" +
      '<span class="fi-source-count">' +
      escapeAttr(countText || "") +
      "</span>";

    var body = document.createElement("div");
    body.className = "fi-source-body";

    details.appendChild(summary);
    details.appendChild(body);

    var loaded = false;
    details.addEventListener("toggle", function () {
      if (!details.open || loaded) return;
      loaded = true;
      renderBody(body);
    });
    if (startOpen) {
      loaded = true;
      renderBody(body);
    }
    return details;
  }

  function renderFalloutGroup(root) {
    var falloutFolder =
      state.folderIndex && state.folderIndex.ok
        ? (state.folderIndex.folders || []).find(function (f) {
            return f.id === "saved-fallout";
          })
        : null;
    if (!falloutFolder || !falloutFolder.children || !falloutFolder.children.length) return;

    var group = document.createElement("div");
    group.className = "fi-source-group";
    group.dataset.sourceId = "saved-fallout";
    group.id = sourceDomId("saved-fallout");
    var groupHead = document.createElement("div");
    groupHead.className = "fi-source-group-head";
    groupHead.innerHTML =
      '<span class="fi-source-title">' +
      escapeAttr(falloutFolder.label) +
      '</span><span class="fi-source-count">' +
      (falloutFolder.count || 0) +
      " total · 3D look textures</span>";
    group.appendChild(groupHead);
    var falloutHint = document.createElement("p");
    falloutHint.className = "fi-fallout-hint";
    falloutHint.textContent =
      "gallery/saved-fallout/{direction} — compass sky textures · drag or arrow keys to look.";
    group.appendChild(falloutHint);
    falloutFolder.children.forEach(function (child) {
      group.appendChild(
        makeSourceBlock(
          child.id,
          child.label,
          (child.count || 0) + " images",
          function (bodyEl) {
            renderFalloutSection(child.id, child.label, child.compass, bodyEl);
          },
          false
        )
      );
    });
    root.appendChild(group);
  }

  function renderSources() {
    var root = $("fi-acquired-sources");
    if (!root) return;
    root.innerHTML = "";

    var library = document.createElement("div");
    library.className = "fi-library-group";
    library.dataset.sourceId = "library";
    var libraryHead = document.createElement("div");
    libraryHead.className = "fi-library-group-head";
    libraryHead.innerHTML =
      '<h4>Equip library</h4>' +
      '<p class="fi-library-group-hint">Same flow as painting spells — click a thumb to fill the active slot. Mix #paintings with LOD1s and your uploads.</p>';
    library.appendChild(libraryHead);

    library.appendChild(
      makeSourceBlock(
        "paintings",
        "1000 Paintings",
        state.paintings.length + " spells",
        renderPaintingsSection,
        true
      )
    );

    library.appendChild(
      makeSourceBlock(
        LOD1_SOURCE_ID,
        "LOD1s · gallery/generated",
        indexedFolderCount(LOD1_SOURCE_ID) + " images · click to equip",
        function (bodyEl) {
          renderLod1Section(bodyEl);
        },
        true
      )
    );

    library.appendChild(
      makeSourceBlock(
        "uploads",
        "My uploads",
        state.uploads.length + " files",
        renderUploadsSection,
        false
      )
    );

    library.appendChild(
      makeSourceBlock(
        SAVED_STASIS_ID,
        "Saved stasis · gallery/saved-stasis",
        indexedFolderCount(SAVED_STASIS_ID) + " images",
        function (bodyEl) {
          renderSavedStasisSection(bodyEl);
        },
        false
      )
    );

    library.appendChild(
      makeSourceBlock(
        "session",
        "Live session",
        state.sessionItems.length ? "1 vision" : "none",
        renderSessionSection,
        false
      )
    );

    root.appendChild(library);
    renderFalloutGroup(root);

    if (!state.folderIndex || !state.folderIndex.ok) {
      var note = document.createElement("p");
      note.className = "fi-acquired-note";
      note.textContent = isLocalServer()
        ? "LOD1s load from data/lod1-manifest.json. Start the server for live saved-stasis & fallout folders."
        : "LOD1s load from the manifest. Run the local server for saved-stasis & fallout.";
      root.appendChild(note);
    }

    applyLibraryFilter(state.libraryFilter);
  }

  function refreshAll() {
    state.folderCache = {};
    state.loadingFolder = {};
    state.sessionItems = buildSessionItems();
    return listUploads()
      .then(function (rows) {
        state.uploads = rows;
        return fetchFolderIndex();
      })
      .then(function (index) {
        state.folderIndex = index;
        var preload = Promise.resolve();
        if (isLocalServer()) {
          preload = Promise.all([
            fetchFolderFiles(GENERATED_ID, true).then(function (files) {
              syncGeneratedCache(files);
              return files;
            }),
            fetchFolderFiles(SAVED_STASIS_ID, true).then(function (files) {
              syncStasisCache(files);
              return files;
            }),
          ]);
        }
        return Promise.all([loadLod1Manifest(), preload]).then(function () {
          restoreSlotUrls();
          renderSources();
          renderSlots();
        });
      });
  }

  function handleUploadFiles(fileList) {
    var files = Array.from(fileList || []).filter(function (f) {
      return f.type && f.type.indexOf("image/") === 0;
    });
    if (!files.length) return Promise.resolve();
    return Promise.all(files.map(function (file) { return putUpload(file); })).then(function () {
      return listUploads().then(function (rows) {
        state.uploads = rows;
        renderSources();
      });
    });
  }

  function bind() {
    var search = $("fi-acquired-search");
    if (search) {
      search.addEventListener(
        "input",
        function () {
          renderSources();
        },
        { passive: true }
      );
    }
    var refreshBtn = $("fi-refresh-acquired");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        refreshAll().then(function () {
          loadCompassTextures(true);
        });
      });
    }
    document.querySelectorAll(".fi-lib-filter").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyLibraryFilter(btn.dataset.filter || "all");
      });
    });
    var uploadInput = $("fi-upload-input");
    var uploadBtn = $("fi-upload-btn");
    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener("click", function () {
        uploadInput.click();
      });
      uploadInput.addEventListener("change", function () {
        handleUploadFiles(uploadInput.files).finally(function () {
          uploadInput.value = "";
        });
      });
    }
    var randomSlotBtn = $("fi-randomize-slot");
    if (randomSlotBtn) {
      randomSlotBtn.addEventListener("click", function () {
        randomizeActiveSlot().then(function (ok) {
          if (!ok) window.alert("Painting list not loaded yet — try again in a moment.");
        });
      });
    }
    var randomSlotsBtn = $("fi-randomize-slots");
    if (randomSlotsBtn) {
      randomSlotsBtn.addEventListener("click", function () {
        randomizeAllSlots().then(function (ok) {
          if (!ok) window.alert("Painting list not loaded yet — try again in a moment.");
        });
      });
    }
  }

  function boot() {
    if (!$("fi-acquired-rail")) return;
    state.slots = loadSlots();
    state.activeSlot = loadActiveSlot();
    bind();
    renderSlots();
    loadLod1Manifest().then(function () {
      return loadPaintings().then(refreshAll);
    });
  }

  window.FleetingAcquired = {
    refresh: refreshAll,
    refreshGenerated: refreshGeneratedSectionOnly,
    refreshSavedStasis: refreshSavedStasisSectionOnly,
    equipLatestGenerated: equipLatestGenerated,
    equipLatestStasis: equipLatestStasis,
    loadCompassTextures: loadCompassTextures,
    getSlots: function () {
      return state.slots.slice();
    },
    getActiveSlot: function () {
      return state.activeSlot;
    },
    equipActive: pickItem,
    randomizeActiveSlot: randomizeActiveSlot,
    randomizeAllSlots: randomizeAllSlots,
    jumpToFolder: jumpToFolder,
    notifyGeneratedAdded: function (url) {
      if (url && String(url).indexOf("/generated/") >= 0) {
        refreshGeneratedSectionOnly();
      }
    },
  };

  window.addEventListener("fleeting-idea-show", function () {
    refreshAll().then(function () {
      startGeneratedPoll();
      startSavedStasisPoll();
    });
  });

  window.addEventListener("fleeting-idea-hide", function () {
    stopGeneratedPoll();
    stopSavedStasisPoll();
  });

  window.addEventListener("fi-generated-new", function () {
    refreshGeneratedSectionOnly();
  });

  window.addEventListener("spellforge-fusion", function (e) {
    var url = e.detail && e.detail.visionUrl;
    if (url && String(url).indexOf("/generated/") >= 0) {
      refreshGeneratedSectionOnly();
    }
  });

  window.addEventListener("gallery-data-ready", function () {
    loadPaintings().then(function () {
      renderSources();
    });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();