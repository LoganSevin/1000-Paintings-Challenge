/*
 * Online users: a panel beside "Last generated" listing everyone here now.
 * - Each visitor has a name (shared with page chat). New visitors get a
 *   friendly default; right-click your own name tag to rename it.
 * - tab-presence.js carries the name (and your last still) on its heartbeat;
 *   server-window.js records who generated each still. Both return the list.
 * - Every tag: "View last generated" (lightbox) and Spell 1/2/3, which put
 *   that still into Spellforge's slot and open the Spellforge tab.
 */
(function () {
  "use strict";

  var NAME_KEY = "pageChatName"; // same name the page chat uses
  var LAST_KEY = "l7in_online_last_v1"; // per tab session, like the presence sid
  var NAME_MAX = 32;
  var SPELL_EDGE = 1280;

  var ADJECTIVES = [
    "Amber", "Azure", "Bold", "Brisk", "Cobalt", "Crimson", "Dappled", "Dusky", "Gilded", "Golden",
    "Hazy", "Indigo", "Ivory", "Jade", "Lucid", "Lunar", "Misty", "Mossy", "Ochre", "Opal",
    "Quiet", "Rosy", "Russet", "Saffron", "Scarlet", "Sepia", "Silver", "Smoky", "Sunny", "Teal",
    "Umber", "Velvet", "Violet", "Wild", "Witty",
  ];
  var PAINTERS = [
    "Bosch", "Cassatt", "Cezanne", "Dali", "Degas", "Escher", "Frida", "Gauguin", "Goya", "Hokusai",
    "Hopper", "Kahlo", "Klimt", "Kandinsky", "Lautrec", "Magritte", "Manet", "Matisse", "Miro", "Monet",
    "Morisot", "Munch", "Okeeffe", "Pollock", "Raphael", "Rembrandt", "Renoir", "Rothko", "Rubens", "Seurat",
    "Titian", "Turner", "VanGogh", "Vermeer", "Warhol",
  ];

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  /** Mirrors cleanName() in netlify/functions/_online.mjs. */
  function cleanName(raw) {
    var s = String(raw == null ? "" : raw);
    try {
      s = s.normalize("NFKC");
    } catch (e) {}
    s = s
      .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return Array.from(s).slice(0, NAME_MAX).join("").trim();
  }

  function defaultName() {
    return pick(ADJECTIVES) + " " + pick(PAINTERS);
  }

  var myName = "";

  function readName() {
    var n = "";
    try {
      n = cleanName(localStorage.getItem(NAME_KEY));
    } catch (e) {}
    if (!n) {
      n = defaultName();
      try {
        localStorage.setItem(NAME_KEY, n);
      } catch (e2) {}
    }
    return n;
  }

  function beat() {
    try {
      if (window.L7inPresence && window.L7inPresence.beat) window.L7inPresence.beat();
    } catch (e) {}
  }

  function setName(raw) {
    var next = cleanName(raw);
    if (!next) return myName;
    var changed = next !== myName;
    myName = next;
    try {
      localStorage.setItem(NAME_KEY, next);
    } catch (e) {}
    if (changed) {
      try {
        window.dispatchEvent(new CustomEvent("l7in-name-changed", { detail: { name: next } }));
      } catch (e2) {}
      beat();
    }
    return myName;
  }

  function readLast() {
    try {
      var raw = JSON.parse(sessionStorage.getItem(LAST_KEY) || "null");
      if (raw && raw.at && (raw.image || raw.remote)) return raw;
    } catch (e) {}
    return null;
  }

  function setLast(last) {
    if (!last || !last.at || !(last.image || last.remote)) return;
    var keep = { at: last.at, tab: last.tab || "", name: last.name || myName };
    if (last.image) keep.image = true;
    else keep.remote = last.remote;
    try {
      sessionStorage.setItem(LAST_KEY, JSON.stringify(keep));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("l7in-user-last", { detail: keep }));
    } catch (e2) {}
    beat();
  }

  myName = readName();

  window.L7inIdentity = {
    name: function () {
      return myName || (myName = readName());
    },
    setName: setName,
    last: readLast,
    setLast: setLast,
    clean: cleanName,
  };

  // ---------------------------------------------------------------- panel

  var users = [];
  var youId = "";
  var editing = false;
  var rows = {};
  var listEl = null;
  var statusEl = null;
  var statusTimer = null;
  var stageUser = null;
  var rootEl = null;

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ago(at) {
    var s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 45) return "just now";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  function stillUrl(user) {
    var last = user && user.last;
    if (!last) return "";
    if (last.image) {
      return "/api/server-window?image=1&user=" + encodeURIComponent(user.id) + "&v=" + encodeURIComponent(last.at);
    }
    return last.remote || "";
  }

  function selfUser() {
    var mine = null;
    for (var i = 0; i < users.length; i++) if (youId && users[i].id === youId) mine = users[i];
    var last = (mine && mine.last) || readLast();
    return {
      id: youId || "self",
      name: myName,
      tab: (mine && mine.tab) || "",
      last: youId ? last : null,
      self: true,
    };
  }

  function viewList() {
    var out = [selfUser()];
    for (var i = 0; i < users.length; i++) {
      if (youId && users[i].id === youId) continue;
      out.push(users[i]);
    }
    return out;
  }

  function findUser(id) {
    var list = viewList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function say(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.hidden = !text;
    if (statusTimer) clearTimeout(statusTimer);
    if (text) {
      statusTimer = setTimeout(function () {
        statusEl.textContent = "";
        statusEl.hidden = true;
      }, 4000);
    }
  }

  var EYE_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M1.8 12C4 7.6 7.7 5.2 12 5.2s8 2.4 10.2 6.8C20 16.4 16.3 18.8 12 18.8S4 16.4 1.8 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';

  function iconButton(cls, label, html) {
    var b = el("button", "ou-btn " + cls);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = html;
    return b;
  }

  // One compact row: thumbnail (opens the still), name, and four tiny buttons.
  function buildRow(id) {
    var li = el("li", "ou-user");
    li.setAttribute("data-id", id);

    var thumb = el("button", "ou-thumb");
    thumb.type = "button";
    var img = el("img");
    img.alt = "";
    img.loading = "lazy";
    img.hidden = true;
    var initial = el("span", "ou-initial");
    initial.setAttribute("aria-hidden", "true");
    thumb.appendChild(img);
    thumb.appendChild(initial);

    var main = el("div", "ou-main");
    var tag = el("div", "ou-tag");
    var name = el("span", "ou-name");
    var you = el("span", "ou-you", " (you)");
    tag.appendChild(name);
    tag.appendChild(you);

    var actions = el("div", "ou-actions");
    actions.appendChild(iconButton("ou-view", "View last generated", EYE_SVG));
    for (var s = 0; s < 3; s++) {
      var b = iconButton("ou-spell", "Use as Spell " + (s + 1), String(s + 1));
      b.setAttribute("data-slot", String(s));
      actions.appendChild(b);
    }

    main.appendChild(tag);
    main.appendChild(actions);
    li.appendChild(thumb);
    li.appendChild(main);
    return li;
  }

  function paintRow(li, user) {
    var self = !!user.self;
    li.classList.toggle("is-self", self);
    li.classList.toggle("has-last", !!user.last);
    var name = li.querySelector(".ou-name");
    if (!(self && editing) && name && name.textContent !== user.name) name.textContent = user.name;

    var bits = [];
    if (user.tab) bits.push("#" + user.tab);
    if (user.last) bits.push("made " + ago(user.last.at));
    else bits.push("nothing generated yet");
    var info = bits.join(" \u00b7 ");
    li.setAttribute("data-info", info);
    if (name) {
      name.title = self
        ? user.name + " (you) \u00b7 " + info + "\nRight-click (or long-press) to rename"
        : user.name + " \u00b7 " + info;
    }
    var you = li.querySelector(".ou-you");
    if (you) you.hidden = !self;

    var src = stillUrl(user);
    var img = li.querySelector(".ou-thumb img");
    var initial = li.querySelector(".ou-initial");
    var thumb = li.querySelector(".ou-thumb");
    if (img) {
      if (src) {
        if (img.getAttribute("src") !== src) img.src = src;
        img.hidden = false;
      } else {
        img.hidden = true;
        img.removeAttribute("src");
      }
    }
    if (initial) {
      initial.textContent = Array.from(user.name || "?")[0].toUpperCase();
      initial.hidden = !!src;
    }
    var viewLabel = "View " + (self ? "your" : user.name + "\u2019s") + " last generated";
    if (thumb) {
      thumb.setAttribute("aria-label", viewLabel);
      thumb.title = viewLabel + " \u00b7 " + info;
    }
    var view = li.querySelector(".ou-view");
    if (view) {
      view.setAttribute("aria-label", viewLabel);
      view.title = "View last generated";
    }
    var spellBtns = li.querySelectorAll(".ou-spell");
    for (var i = 0; i < spellBtns.length; i++) {
      spellBtns[i].disabled = !user.last;
      spellBtns[i].title = user.last
        ? "Use as Spell " + (i + 1)
        : "Use as Spell " + (i + 1) + " (" + user.name + " has not generated anything yet)";
    }
  }

  function render() {
    if (!listEl) return;
    var list = viewList();
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var u = list[i];
      var key = u.self ? "self" : u.id;
      seen[key] = true;
      var li = rows[key];
      if (!li) {
        li = buildRow(key);
        rows[key] = li;
      }
      if (listEl.children[i] !== li) listEl.insertBefore(li, listEl.children[i] || null);
      li.setAttribute("data-id", u.id);
      paintRow(li, u);
    }
    for (var k in rows) {
      if (!Object.prototype.hasOwnProperty.call(rows, k) || seen[k]) continue;
      if (rows[k].parentNode) rows[k].parentNode.removeChild(rows[k]);
      delete rows[k];
    }
    var head = $("online-users-count");
    if (head) head.textContent = String(list.length);
    var chipCount = $("online-users-chip-count");
    if (chipCount) chipCount.textContent = String(list.length);
    var chip = $("online-users-chip");
    if (chip) chip.setAttribute("aria-label", "Here now: " + list.length + (list.length === 1 ? " person" : " people") + ". Show who is online");
    if (stageUser) {
      var fresh = findUser(stageUser.id);
      if (fresh && (!stageUser.last || (fresh.last && fresh.last.at !== stageUser.last.at) || fresh.name !== stageUser.name)) {
        openStage(fresh);
      }
    }
  }

  function onUsers(ev) {
    var d = (ev && ev.detail) || {};
    if (!Array.isArray(d.users)) return;
    if (d.you) youId = d.you;
    var next = [];
    for (var i = 0; i < d.users.length && next.length < 200; i++) {
      var u = d.users[i];
      if (!u || !u.id) continue;
      next.push({
        id: String(u.id),
        name: cleanName(u.name) || "guest",
        tab: String(u.tab || ""),
        last: u.last && u.last.at ? u.last : null,
      });
    }
    users = next;
    render();
  }

  // ---------------------------------------------------------------- rename

  function startRename(li) {
    if (editing) return;
    var name = li.querySelector(".ou-name");
    if (!name) return;
    editing = true;
    var input = el("input", "ou-name-input");
    input.type = "text";
    input.maxLength = NAME_MAX;
    input.value = myName;
    input.spellcheck = false;
    input.setAttribute("aria-label", "Your name");
    name.hidden = true;
    name.parentNode.insertBefore(input, name);
    li.classList.add("is-editing");
    input.focus();
    input.select();
    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      if (save) {
        var before = myName;
        var after = setName(input.value);
        if (after !== before) say("You are now \u201c" + after + "\u201d");
      }
      editing = false;
      li.classList.remove("is-editing");
      if (input.parentNode) input.parentNode.removeChild(input);
      name.hidden = false;
      render();
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener("blur", function () {
      finish(true);
    });
    input.addEventListener("contextmenu", function (e) {
      e.stopPropagation();
    });
  }

  // ---------------------------------------------------------------- lightbox

  function stageEl() {
    var stage = $("online-users-stage");
    if (stage) return stage;
    stage = el("div", "ou-stage");
    stage.id = "online-users-stage";
    stage.hidden = true;
    stage.setAttribute("role", "dialog");
    stage.setAttribute("aria-modal", "true");
    stage.innerHTML =
      '<div class="ou-stage-card">' +
      '<button type="button" class="ou-stage-close" aria-label="Close">Close</button>' +
      '<div class="ou-stage-media"><img class="ou-stage-img" alt="" />' +
      '<p class="ou-stage-empty" hidden></p></div>' +
      '<div class="ou-stage-foot">' +
      '<p class="ou-stage-caption"></p>' +
      '<div class="ou-stage-spells">' +
      '<button type="button" class="ou-btn ou-spell" data-slot="0">Spell 1</button>' +
      '<button type="button" class="ou-btn ou-spell" data-slot="1">Spell 2</button>' +
      '<button type="button" class="ou-btn ou-spell" data-slot="2">Spell 3</button>' +
      "</div></div></div>";
    document.body.appendChild(stage);
    stage.addEventListener("click", function (e) {
      if (e.target === stage || (e.target.closest && e.target.closest(".ou-stage-close"))) {
        closeStage();
        return;
      }
      var spell = e.target.closest && e.target.closest(".ou-spell");
      if (spell && stageUser) sendToSpell(stageUser, parseInt(spell.getAttribute("data-slot"), 10));
    });
    return stage;
  }

  function openStage(user) {
    var stage = stageEl();
    stageUser = user;
    var img = stage.querySelector(".ou-stage-img");
    var empty = stage.querySelector(".ou-stage-empty");
    var caption = stage.querySelector(".ou-stage-caption");
    var src = stillUrl(user);
    var label = user.self ? "Your last generated" : user.name + "\u2019s last generated";
    stage.setAttribute("aria-label", label);
    if (src) {
      if (img.getAttribute("src") !== src) img.src = src;
      img.alt = label;
      img.hidden = false;
      empty.hidden = true;
      var bits = [label, "#" + (user.last.tab || "gallery"), ago(user.last.at)];
      if (user.last.name && user.last.name !== user.name) bits.push("made as \u201c" + user.last.name + "\u201d");
      caption.textContent = bits.join(" \u00b7 ");
    } else {
      img.hidden = true;
      img.removeAttribute("src");
      empty.hidden = false;
      empty.textContent = user.self
        ? "You haven\u2019t generated anything yet. Make an image in any tab and it shows up here."
        : user.name + " hasn\u2019t generated anything yet. Their next image will show up here.";
      caption.textContent = label;
    }
    var spellBtns = stage.querySelectorAll(".ou-spell");
    for (var i = 0; i < spellBtns.length; i++) spellBtns[i].disabled = !src;
    stage.hidden = false;
    stage.classList.add("is-open");
    document.body.classList.add("ou-stage-open");
  }

  function closeStage() {
    var stage = $("online-users-stage");
    stageUser = null;
    if (!stage || stage.hidden) return;
    stage.hidden = true;
    stage.classList.remove("is-open");
    document.body.classList.remove("ou-stage-open");
  }

  // ---------------------------------------------------------------- spells

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("read"));
      };
      reader.readAsDataURL(blob);
    });
  }

  // Slot copies live in localStorage, so keep them modest.
  function shrink(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || 1;
          var h = img.naturalHeight || 1;
          var scale = Math.min(1, SPELL_EDGE / Math.max(w, h));
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(w * scale));
          c.height = Math.max(1, Math.round(h * scale));
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.85));
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function stillForSpell(user) {
    var last = user.last;
    var metaP = fetch("/api/server-window?user=" + encodeURIComponent(user.id), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        return (d && d.last && d.last.prompt) || "";
      })
      .catch(function () {
        return "";
      });
    var urlP;
    if (last.image) {
      urlP = fetch(stillUrl(user))
        .then(function (r) {
          if (!r.ok) throw new Error("This image is no longer stored.");
          return r.blob();
        })
        .then(blobToDataUrl)
        .then(shrink);
    } else {
      urlP = Promise.resolve(last.remote);
    }
    return Promise.all([urlP, metaP]).then(function (res) {
      return { url: res[0], prompt: res[1] };
    });
  }

  function whenSpellforgeApi() {
    return new Promise(function (resolve) {
      var tries = 0;
      (function check() {
        if (window.SpellforgeAPI && window.SpellforgeAPI.equipImage) return resolve(window.SpellforgeAPI);
        if (++tries > 100) return resolve(null);
        setTimeout(check, 100);
      })();
    });
  }

  var sending = false;

  function sendToSpell(user, slot) {
    if (!user || !user.last || sending) return;
    if (!(slot >= 0 && slot <= 2)) return;
    sending = true;
    var who = user.self ? "Your" : user.name + "\u2019s";
    say("Sending " + who + " image to Spell " + (slot + 1) + "\u2026");
    stillForSpell(user)
      .then(function (still) {
        return whenSpellforgeApi().then(function (api) {
          if (!api) throw new Error("Spellforge is not available on this page.");
          var res = api.equipImage(slot, {
            url: still.url,
            key: user.id + ":" + user.last.at,
            name: user.last.name || user.name,
            tab: user.last.tab,
            at: user.last.at,
            prompt: still.prompt,
          });
          if (!res || !res.ok) throw new Error((res && res.error) || "Could not equip.");
          closeStage();
          setOpen(false);
          if (window.GalleryTabs && window.GalleryTabs.showTab) window.GalleryTabs.showTab("spellforge");
          else location.hash = "spellforge";
          say(who + " image is now Spell " + (slot + 1) + ".");
        });
      })
      .catch(function (err) {
        say((err && err.message) || "Could not send that image.");
      })
      .then(function () {
        sending = false;
      });
  }

  // ---------------------------------------------------------------- wiring

  // Phones / tablets / touch: the list folds into a "Here now N" chip.
  function setOpen(open) {
    if (!rootEl) return;
    rootEl.classList.toggle("is-open", !!open);
    // Lift the window above the page chat / sign-in card while the list is open.
    var win = rootEl.closest && rootEl.closest(".server-window");
    if (win) win.classList.toggle("ou-list-open", !!open);
    var chip = $("online-users-chip");
    if (chip) chip.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function isOpen() {
    return !!(rootEl && rootEl.classList.contains("is-open"));
  }

  function onListClick(e) {
    var li = e.target.closest && e.target.closest(".ou-user");
    if (!li || !listEl.contains(li)) return;
    if (e.target.closest(".ou-name-input")) return;
    var user = findUser(li.getAttribute("data-id"));
    if (!user) return;
    if (e.target.closest(".ou-view, .ou-thumb")) {
      openStage(user);
      return;
    }
    var spell = e.target.closest(".ou-spell");
    if (spell) sendToSpell(user, parseInt(spell.getAttribute("data-slot"), 10));
  }

  function onListContext(e) {
    var li = e.target.closest && e.target.closest(".ou-user");
    if (!li || !li.classList.contains("is-self")) return;
    if (!e.target.closest(".ou-tag, .ou-thumb")) return;
    e.preventDefault();
    startRename(li);
  }

  // Touch screens without a context menu event (iOS): long-press your name.
  function bindLongPress() {
    var timer = null;
    function clear() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
    listEl.addEventListener(
      "touchstart",
      function (e) {
        var li = e.target.closest && e.target.closest(".ou-user.is-self");
        if (!li || !e.target.closest(".ou-tag") || editing) return;
        clear();
        timer = setTimeout(function () {
          timer = null;
          startRename(li);
        }, 550);
      },
      { passive: true }
    );
    listEl.addEventListener("touchend", clear);
    listEl.addEventListener("touchmove", clear, { passive: true });
    listEl.addEventListener("touchcancel", clear);
  }

  function init() {
    listEl = $("online-users-list");
    statusEl = $("online-users-status");
    if (!listEl) return;
    listEl.addEventListener("click", onListClick);
    listEl.addEventListener("contextmenu", onListContext);
    bindLongPress();
    window.addEventListener("presence-users", onUsers);
    window.addEventListener("l7in-user-last", render);
    window.addEventListener("l7in-name-changed", function (e) {
      var n = e && e.detail && e.detail.name;
      if (n && n !== myName) myName = n;
      render();
    });
    window.addEventListener("storage", function (e) {
      if (e.key !== NAME_KEY) return;
      var n = cleanName(e.newValue);
      if (n && n !== myName) {
        myName = n;
        render();
        beat();
      }
    });
    rootEl = $("online-users");
    var chip = $("online-users-chip");
    if (chip) {
      chip.addEventListener("click", function () {
        setOpen(!isOpen());
      });
    }
    document.addEventListener("pointerdown", function (e) {
      if (!isOpen() || editing) return;
      var t = e.target;
      if (rootEl.contains(t)) return;
      var stage = $("online-users-stage");
      if (stage && stage.contains(t)) return;
      setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var stage = $("online-users-stage");
      if (stage && !stage.hidden) closeStage();
      else if (isOpen() && !editing) setOpen(false);
    });
    setInterval(function () {
      if (!document.hidden && !editing) render();
    }, 30000);
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
