/**
 * People beside the last-generated window.
 * Each console has a default name, kept in l7in_server_name_v1.
 * Right-click your own name to change it. View opens that person's still
 * without replacing the corner preview. Spell I, II, and III each equip
 * only the slot on the button.
 */
(function () {
  "use strict";

  var NAME_KEY = "l7in_server_name_v1";
  var STILL_KEY = "l7in_server_last_v1";
  var HEARTBEAT_MS = 8000;
  var selfId = "";
  var selfImage = "";
  var timer = null;
  var editing = false;
  var lastPeople = [];
  var lastSig = "";
  var postedImageKey = "";

  function $(id) {
    return document.getElementById(id);
  }

  function sessionId() {
    try {
      var id = sessionStorage.getItem("tabPresenceSid");
      if (id && id.length >= 8 && id.length <= 80) return id;
      id =
        (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
        "sid-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      id = String(id).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
      if (id.length < 8) id = ("sid" + id + "00000000").slice(0, 12);
      sessionStorage.setItem("tabPresenceSid", id);
      return id;
    } catch (e) {
      return "sid-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
  }

  function guestName(sid) {
    var tail = String(sid || "").replace(/[^A-Za-z0-9]/g, "").slice(-4);
    return "Guest " + (tail || "0000");
  }

  function cleanName(raw) {
    return String(raw || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24)
      .trim();
  }

  function myName() {
    try {
      var saved = cleanName(localStorage.getItem(NAME_KEY) || "");
      if (saved) return saved;
    } catch (e) {}
    return guestName(selfId);
  }

  function rememberName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch (e) {}
  }

  function readLocalStill() {
    try {
      var raw = JSON.parse(localStorage.getItem(STILL_KEY) || "null");
      var image = raw && raw.image;
      if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(image || "")) return image;
    } catch (e) {}
    return "";
  }

  function imageKey(url) {
    url = String(url || "");
    if (url.length < 16) return "";
    return url.length + ":" + url.slice(-48);
  }

  function hasStill(person) {
    if (person && person.sid === selfId && selfImage) return true;
    return !!person && (parseInt(person.stillAt, 10) || 0) > 0;
  }

  function withSelf(people) {
    var others = [];
    var self = null;
    for (var i = 0; i < people.length; i++) {
      var person = people[i];
      if (!person || !person.sid) continue;
      if (person.sid === selfId) self = person;
      else others.push(person);
    }
    if (!self) {
      self = { sid: selfId, name: myName(), seen: Date.now(), stillAt: selfImage ? Date.now() : 0 };
    } else {
      self = {
        sid: selfId,
        name: myName(),
        seen: self.seen || Date.now(),
        stillAt: self.stillAt || (selfImage ? Date.now() : 0),
      };
    }
    others.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    return [self].concat(others);
  }

  function signature(people) {
    return people
      .map(function (p) {
        return [p.sid, p.name, hasStill(p) ? "1" : "0"].join("\t");
      })
      .join("\n");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function paint(people) {
    var list = $("server-people-list");
    if (!list || editing) {
      if (people) lastPeople = people;
      return;
    }
    people = withSelf(people || lastPeople || []);
    lastPeople = people;
    var sig = signature(people);
    if (sig === lastSig) return;
    lastSig = sig;
    var scroll = list.scrollTop;
    list.textContent = "";
    for (var i = 0; i < people.length; i++) {
      list.appendChild(rowFor(people[i]));
    }
    list.scrollTop = scroll;
  }

  function rowFor(person) {
    var self = person.sid === selfId;
    var row = el("li", "server-person" + (self ? " is-self" : ""));
    row.setAttribute("data-sid", person.sid);
    if (self) row.setAttribute("data-self", "1");

    var nameBtn = el("button", "server-person-name", person.name || guestName(person.sid));
    nameBtn.type = "button";
    if (self) {
      nameBtn.title = "Right-click to rename";
      nameBtn.setAttribute("aria-label", (person.name || "You") + ", right-click to rename");
      nameBtn.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        beginRename(nameBtn, person.name);
      });
    } else {
      nameBtn.title = person.name || "";
      nameBtn.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
      });
    }

    var view = el("button", "server-person-view", "View");
    view.type = "button";
    view.title = "View last generated";
    view.disabled = !hasStill(person);
    view.addEventListener("click", function () {
      if (view.disabled) return;
      view.disabled = true;
      stillUrl(person).then(
        function (url) {
          view.disabled = !hasStill(person);
          if (!url || !window.L7inServer || !window.L7inServer.openStill) return;
          window.L7inServer.openStill(url);
          var stage = $("server-window-stage");
          if (stage) stage.setAttribute("aria-label", "Last still from " + (person.name || "someone here"));
        },
        function () {
          view.disabled = !hasStill(person);
        }
      );
    });

    row.appendChild(nameBtn);
    row.appendChild(view);
    ["I", "II", "III"].forEach(function (label, slot) {
      var btn = el("button", "server-person-spell", label);
      btn.type = "button";
      btn.title = "Use as Spell " + label;
      btn.setAttribute("data-slot", String(slot));
      btn.disabled = !hasStill(person);
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        btn.disabled = true;
        equipPerson(person, slot).then(
          function () {
            btn.disabled = !hasStill(person);
          },
          function () {
            btn.disabled = !hasStill(person);
          }
        );
      });
      row.appendChild(btn);
    });
    return row;
  }

  function beginRename(btn, current) {
    if (editing || !btn.parentNode) return;
    editing = true;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "server-person-rename";
    input.value = current || "";
    input.maxLength = 24;
    input.setAttribute("aria-label", "Your name");
    btn.replaceWith(input);
    input.focus();
    input.select();
    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      editing = false;
      var next = save ? cleanName(input.value) : cleanName(current);
      if (!next) next = guestName(selfId);
      rememberName(next);
      lastSig = "";
      paint(lastPeople);
      postRoster();
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", function () {
      finish(true);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("still"));
      };
      reader.readAsDataURL(blob);
    });
  }

  function stillUrl(person) {
    if (person && person.sid === selfId && selfImage) return Promise.resolve(selfImage);
    var sid = person && person.sid;
    if (!sid) return Promise.resolve("");
    return fetch("/api/server-people?image=1&sid=" + encodeURIComponent(sid), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("still");
        return r.blob();
      })
      .then(blobToDataUrl)
      .then(function (url) {
        if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(url)) throw new Error("still");
        return url;
      });
  }

  function equipWhenReady(slot, info) {
    function go() {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.equipVisitorStill === "function") {
        return window.SpellforgeAPI.equipVisitorStill(slot, info);
      }
      return null;
    }
    var ready = go();
    if (ready) return Promise.resolve(ready);
    return new Promise(function (resolve) {
      var n = 0;
      var wait = setInterval(function () {
        n += 1;
        var result = go();
        if (result || n > 50) {
          clearInterval(wait);
          resolve(result || { ok: false });
        }
      }, 100);
    });
  }

  function equipPerson(person, slot) {
    return stillUrl(person).then(function (url) {
      if (!url) throw new Error("still");
      return equipWhenReady(slot, {
        url: url,
        name: person.sid === selfId ? myName() : person.name,
        sid: person.sid,
      });
    }).then(function (result) {
      if (!result || !result.ok) throw new Error("equip");
      var hash = (location.hash || "").replace(/^#/, "").split("?")[0].toLowerCase();
      if (hash !== "spellforge") location.hash = "spellforge";
      return result;
    });
  }

  function applyRoster(data) {
    if (!data || !data.ok || !Array.isArray(data.people)) return;
    paint(data.people);
  }

  function postRoster(extra) {
    if (!selfId || document.hidden) return;
    var body = { sid: selfId, name: myName() };
    if (extra && extra.image) body.image = extra.image;
    if (extra && extra.leave) body.leave = true;
    fetch("/api/server-people", {
      method: "POST",
      cache: "no-store",
      keepalive: !!(extra && extra.leave),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(applyRoster)
      .catch(function () {});
  }

  function noteStill(dataUrl) {
    dataUrl = String(dataUrl || "");
    if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(dataUrl)) return;
    selfImage = dataUrl;
    lastSig = "";
    paint(lastPeople);
    var key = imageKey(dataUrl);
    if (!key || key === postedImageKey) return;
    postedImageKey = key;
    postRoster({ image: dataUrl });
  }

  function start() {
    if (timer) clearInterval(timer);
    timer = null;
    if (document.hidden) return;
    postRoster();
    timer = setInterval(function () {
      if (document.hidden) return;
      postRoster();
    }, HEARTBEAT_MS);
  }

  function init() {
    if (!$("server-people")) return;
    selfId = sessionId();
    rememberName(myName());
    selfImage = readLocalStill();
    paint([]);
    if (selfImage) noteStill(selfImage);
    start();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (timer) clearInterval(timer);
        timer = null;
        return;
      }
      start();
    });
    window.addEventListener("pagehide", function () {
      postRoster({ leave: true });
    });
  }

  window.L7inPeople = { noteStill: noteStill };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
