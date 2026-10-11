/**
 * People beside the last-generated window.
 * The name is the page-chat name (pageChatName). Right-click your own tag
 * to rename it in both places. Each row shows that person's tab and a thumb
 * of their last still. Msg sends them a note. Closing the site moves the
 * row into Offline and keeps the record.
 */
(function () {
  "use strict";

  var CHAT_NAME_KEY = "pageChatName";
  var LEGACY_NAME_KEY = "l7in_server_name_v1";
  var STILL_KEY = "l7in_server_last_v1";
  var HEARTBEAT_MS = 8000;
  var selfId = "";
  var selfImage = "";
  var timer = null;
  var editing = false;
  var composing = false;
  var lastPeople = [];
  var lastMail = [];
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

  function cleanName(raw) {
    return String(raw || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 32)
      .trim();
  }

  function currentTab() {
    var h = (location.hash || "").replace(/^#/, "").split("?")[0].toLowerCase();
    if (!h || h === "subscribe") return "gallery";
    if (h === "0-z" || h === "zeroz" || h === "0z") return "az";
    if (h === "kjv" || h === "scripture") return "bible";
    if (h === "rooms") return "places";
    return h.replace(/[^a-z0-9-]/g, "").slice(0, 40) || "gallery";
  }

  function myName() {
    var input = $("page-chat-name");
    if (input && document.activeElement === input) {
      var live = cleanName(input.value);
      if (live) return live;
    }
    try {
      var saved = cleanName(localStorage.getItem(CHAT_NAME_KEY) || "");
      if (saved) return saved;
      var legacy = cleanName(localStorage.getItem(LEGACY_NAME_KEY) || "");
      if (legacy) {
        localStorage.setItem(CHAT_NAME_KEY, legacy);
        return legacy;
      }
    } catch (e) {}
    var created = "guest-" + String(Math.floor(1000 + Math.random() * 9000));
    try {
      localStorage.setItem(CHAT_NAME_KEY, created);
    } catch (e2) {}
    return created;
  }

  function rememberName(name) {
    try {
      localStorage.setItem(CHAT_NAME_KEY, name);
    } catch (e) {}
    var input = $("page-chat-name");
    if (input && input.value !== name) input.value = name;
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

  function personOnline(person) {
    if (!person) return false;
    if (person.sid === selfId) return true;
    if (person.online === false) return false;
    if (person.online === true) return true;
    var seen = parseInt(person.seen, 10) || 0;
    return !!(seen && Date.now() - seen < 90000);
  }

  function withSelf(people) {
    var online = [];
    var offline = [];
    var self = null;
    for (var i = 0; i < people.length; i++) {
      var person = people[i];
      if (!person || !person.sid) continue;
      if (person.sid === selfId) self = person;
      else if (personOnline(person)) online.push(person);
      else offline.push(person);
    }
    if (!self) {
      self = {
        sid: selfId,
        name: myName(),
        seen: Date.now(),
        stillAt: selfImage ? Date.now() : 0,
        tab: currentTab(),
        online: true,
      };
    } else {
      self = {
        sid: selfId,
        name: myName(),
        seen: self.seen || Date.now(),
        stillAt: self.stillAt || (selfImage ? Date.now() : 0),
        tab: currentTab(),
        online: true,
      };
    }
    online.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    offline.sort(function (a, b) {
      return (parseInt(b.seen, 10) || 0) - (parseInt(a.seen, 10) || 0);
    });
    return { online: [self].concat(online), offline: offline };
  }

  function signature(groups) {
    function line(p) {
      return [p.sid, p.name, p.tab || "", personOnline(p) ? "1" : "0", hasStill(p) ? "1" : "0"].join("\t");
    }
    return groups.online.map(line).join("\n") + "\n--\n" + groups.offline.map(line).join("\n");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function paint(people) {
    var list = $("server-people-list");
    if (!list || editing || composing) {
      if (people) lastPeople = people;
      return;
    }
    var groups = withSelf(people || lastPeople || []);
    lastPeople = people || lastPeople || [];
    var sig = signature(groups);
    if (sig === lastSig) return;
    lastSig = sig;
    var scroll = list.scrollTop;
    list.textContent = "";
    for (var i = 0; i < groups.online.length; i++) list.appendChild(rowFor(groups.online[i], true));
    if (groups.offline.length) {
      list.appendChild(el("li", "server-people-offline-label", "Offline"));
      for (var j = 0; j < groups.offline.length; j++) list.appendChild(rowFor(groups.offline[j], false));
    }
    list.scrollTop = scroll;
  }

  function stillThumb(person) {
    var src = "";
    if (person.sid === selfId && selfImage) src = selfImage;
    else if (hasStill(person)) {
      src = "/api/server-people?image=1&sid=" + encodeURIComponent(person.sid) + "&v=" + (person.stillAt || 1);
    }
    if (!src) return el("span", "server-person-still is-empty");
    var img = el("img", "server-person-still");
    img.alt = "Last still";
    img.src = src;
    img.addEventListener("error", function () {
      img.classList.add("is-empty");
      img.removeAttribute("src");
    });
    img.addEventListener("click", function (ev) {
      ev.preventDefault();
    });
    return img;
  }

  function rowFor(person, online) {
    var self = person.sid === selfId;
    var row = el("li", "server-person" + (self ? " is-self" : "") + (online ? "" : " is-offline"));
    row.setAttribute("data-sid", person.sid);
    if (self) row.setAttribute("data-self", "1");

    var id = el("div", "server-person-id");
    var nameBtn = el("button", "server-person-name", person.name || "guest");
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
    var tab = el("span", "server-person-tab", person.tab || currentTab());
    id.appendChild(nameBtn);
    id.appendChild(tab);

    row.appendChild(stillThumb(person));
    row.appendChild(id);
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
    if (!self) {
      var msg = el("button", "server-person-msg", "Msg");
      msg.type = "button";
      msg.title = "Send a message";
      msg.addEventListener("click", function () {
        toggleCompose(row, person);
      });
      row.appendChild(msg);
    }
    return row;
  }

  function toggleCompose(row, person) {
    var open = row.querySelector(".server-person-compose");
    if (open) {
      open.remove();
      composing = !!document.querySelector(".server-person-compose");
      if (!composing) {
        lastSig = "";
        paint(lastPeople);
      }
      return;
    }
    document.querySelectorAll(".server-person-compose").forEach(function (node) {
      node.remove();
    });
    composing = true;
    var form = document.createElement("form");
    form.className = "server-person-compose";
    var input = document.createElement("input");
    input.type = "text";
    input.maxLength = 200;
    input.setAttribute("aria-label", "Message " + (person.name || ""));
    input.placeholder = "Message " + (person.name || "");
    var send = el("button", "", "Send");
    send.type = "submit";
    form.appendChild(input);
    form.appendChild(send);
    row.appendChild(form);
    input.focus();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = String(input.value || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) return;
      composing = false;
      form.remove();
      postRoster({ to: person.sid, text: text });
      lastSig = "";
      paint(lastPeople);
    });
  }

  function beginRename(btn, current) {
    if (editing || !btn.parentNode) return;
    editing = true;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "server-person-rename";
    input.value = current || "";
    input.maxLength = 32;
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
      if (!next) next = myName();
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

  function nameFor(sid) {
    if (sid === selfId) return myName();
    for (var i = 0; i < lastPeople.length; i++) {
      if (lastPeople[i] && lastPeople[i].sid === sid) return lastPeople[i].name;
    }
    return "";
  }

  function paintMail(mail) {
    lastMail = mail || [];
    var box = $("server-people-mail");
    if (!box) return;
    var mine = lastMail.filter(function (m) {
      return m && (m.to === selfId || m.from === selfId);
    }).slice(-12);
    box.textContent = "";
    mine.forEach(function (m) {
      var who = m.from === selfId ? "You → " + (nameFor(m.to) || "them") : m.fromName || "Someone";
      box.appendChild(el("li", "server-people-mail-line", who + ": " + (m.text || "")));
    });
    box.hidden = mine.length === 0;
    box.scrollTop = box.scrollHeight;
  }

  function applyRoster(data) {
    if (!data || !data.ok) return;
    if (Array.isArray(data.people)) paint(data.people);
    if (Array.isArray(data.mail)) paintMail(data.mail);
  }

  function postRoster(extra) {
    if (!selfId) return;
    if (document.hidden && !(extra && extra.leave)) return;
    var body = { sid: selfId, name: myName(), tab: currentTab() };
    if (extra && extra.image) body.image = extra.image;
    if (extra && extra.leave) body.leave = true;
    if (extra && extra.to) body.to = extra.to;
    if (extra && extra.text) body.text = extra.text;
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

  function syncFromChat(post) {
    lastSig = "";
    paint(lastPeople);
    if (post) postRoster();
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
    document.addEventListener("input", function (e) {
      if (e.target && e.target.id === "page-chat-name") syncFromChat(false);
    });
    document.addEventListener("change", function (e) {
      if (e.target && e.target.id === "page-chat-name") syncFromChat(true);
    });
    window.addEventListener("storage", function (e) {
      if (e.key === CHAT_NAME_KEY) syncFromChat(false);
    });
    window.addEventListener("hashchange", function () {
      lastSig = "";
      paint(lastPeople);
      postRoster();
    });
    window.addEventListener("tab-changed", function () {
      lastSig = "";
      paint(lastPeople);
      postRoster();
    });
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
