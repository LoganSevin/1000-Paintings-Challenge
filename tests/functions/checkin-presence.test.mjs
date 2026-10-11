import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { BlobsServer } from "@netlify/blobs/server";
import { getStore, setEnvironmentContext } from "@netlify/blobs";

const require = createRequire(import.meta.url);
const { decide } = require("../../scripts/netlify-ignore.js");

let server;
let dir;
let checkin;
let presence;
let serverWindow;
let serverPeople;

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "blobs-"));
  server = new BlobsServer({ directory: dir, token: "t0ken", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site-1", token: "t0ken", edgeURL: url, uncachedEdgeURL: url });
  checkin = (await import("../../netlify/functions/gallery-checkin.mjs")).default;
  presence = (await import("../../netlify/functions/presence.mjs")).default;
  serverWindow = (await import("../../netlify/functions/server-window.mjs")).default;
  serverPeople = (await import("../../netlify/functions/server-people.mjs")).default;
});

test.after(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});

const post = (url, body) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("checkin bump counts opens and live presence from one aggregate record", async () => {
  let res = await checkin(post("http://x/api/gallery-checkin", { tab: "gallery", id: "visitor-aaaa1", bump: true }));
  let d = await res.json();
  assert.equal(res.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.deepEqual(d.counts.gallery, { opens: 1, live: 1 });

  await checkin(post("http://x/api/gallery-checkin", { tab: "coins", id: "visitor-bbbb2", bump: true }));
  await checkin(post("http://x/api/gallery-checkin", { tab: "gallery", id: "visitor-aaaa1", bump: false }));

  res = await checkin(new Request("http://x/api/gallery-checkin"));
  d = await res.json();
  assert.deepEqual(d.counts.gallery, { opens: 1, live: 1 });
  assert.deepEqual(d.counts.coins, { opens: 1, live: 1 });
  // GET is the same for everyone: short CDN cache, browser revalidates.
  assert.match(res.headers.get("netlify-cdn-cache-control") || "", /s-maxage=10/);
  assert.match(res.headers.get("cache-control") || "", /max-age=0/);

  const store = getStore({ name: "gallery-meta", consistency: "strong" });
  const { blobs } = await store.list();
  const keys = blobs.map((b) => b.key).sort();
  assert.deepEqual(keys, ["presence-v2", "tab-opens-v2"], "no per-visitor blobs");
});

test("checkin presence entries expire after the TTL", async () => {
  const store = getStore({ name: "gallery-meta", consistency: "strong" });
  await store.setJSON("presence-v2", {
    "old-visitor-1": { tab: "gallery", seen: Date.now() - 5 * 60 * 1000 },
    "new-visitor-1": { tab: "slots", seen: Date.now() },
  });
  const d = await (await checkin(new Request("http://x/api/gallery-checkin"))).json();
  assert.equal(d.counts.slots.live, 1);
  assert.equal(d.counts.gallery.live, 0);
});

test("presence heartbeat also returns tab-open totals", async () => {
  let d = await (await presence(post("http://x/api/presence", { sid: "session-1234", tab: "gallery" }))).json();
  assert.equal(d.ok, true);
  assert.equal(d.counts.gallery, 1);
  assert.equal(d.opens.gallery, 1);
  assert.equal(d.opens.coins, 1);
  d = await (await presence(new Request("http://x/api/presence"))).json();
  assert.equal(d.opens.gallery, 1);
  const leave = await (await presence(post("http://x/api/presence", { sid: "session-1234", leave: true }))).json();
  assert.equal(leave.counts.gallery, undefined);
});

test("server window counts live consoles and keeps the latest still", async () => {
  const presenceStore = getStore({ name: "tab-presence", consistency: "strong" });
  const now = Date.now();
  await presenceStore.setJSON("presence", {
    "session-aaaa": { tab: "spellforge", ts: now },
    "session-bbbb": { tab: "gallery", ts: now },
    "session-old1": { tab: "gallery", ts: now - 60000 },
    "nope": { tab: "gallery", ts: now },
  });

  let res = await serverWindow(new Request("http://x/api/server-window"));
  let d = await res.json();
  assert.equal(res.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(d.ok, true);
  assert.equal(d.online, 2);
  assert.equal(d.last, null);

  const jpeg = "data:image/jpeg;base64," + Buffer.from([
    0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]).toString("base64");
  res = await serverWindow(post("http://x/api/server-window", { image: jpeg, tab: "Spellforge" }));
  d = await res.json();
  assert.equal(res.status, 200);
  assert.equal(d.ok, true);
  assert.equal(d.online, 2);
  assert.equal(d.last.tab, "spellforge");
  assert.equal(d.last.image, true);
  assert.ok(d.last.at);

  res = await serverWindow(new Request("http://x/api/server-window?image=1"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);

  const png = "data:image/png;base64," + Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]).toString("base64");
  res = await serverWindow(post("http://x/api/server-window", { image: png, tab: "colors" }));
  d = await res.json();
  assert.equal(d.last.tab, "colors");
  res = await serverWindow(new Request("http://x/api/server-window?image=1"));
  assert.equal(res.headers.get("content-type"), "image/png");

  res = await serverWindow(post("http://x/api/server-window", { image: "data:text/plain;base64,aGVsbG8=", tab: "spellforge" }));
  assert.equal(res.status, 400);
  res = await serverWindow(new Request("http://x/api/server-window"));
  d = await res.json();
  assert.equal(d.last.tab, "colors", "a refused post leaves the latest still");

  res = await serverWindow(post("http://x/api/server-window", {
    remote: "https://l7in-generated.netlify.app/generated/1.jpg",
    tab: "animate",
  }));
  d = await res.json();
  assert.equal(d.last.tab, "animate");
  assert.equal(d.last.remote, "https://l7in-generated.netlify.app/generated/1.jpg");
  assert.equal(d.last.image, undefined);
  res = await serverWindow(new Request("http://x/api/server-window?image=1"));
  assert.equal(res.status, 404);
});

test("server window accepts a sharp still and refuses one past the cap", async () => {
  function jpegOf(n) {
    const buf = Buffer.alloc(n);
    buf[0] = 0xff;
    buf[1] = 0xd8;
    buf[2] = 0xff;
    buf[n - 1] = 0xd9;
    return "data:image/jpeg;base64," + buf.toString("base64");
  }
  const sharp = jpegOf(120000);
  let res = await serverWindow(post("http://x/api/server-window", { image: sharp, tab: "gallery" }));
  let d = await res.json();
  assert.equal(res.status, 200);
  assert.equal(d.ok, true);
  assert.equal(d.last.image, true);
  res = await serverWindow(new Request("http://x/api/server-window?image=1"));
  assert.equal(res.status, 200);
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(buf.length, 120000);
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);

  res = await serverWindow(post("http://x/api/server-window", { image: jpegOf(670001), tab: "gallery" }));
  assert.equal(res.status, 400);
  res = await serverWindow(new Request("http://x/api/server-window?image=1"));
  const kept = new Uint8Array(await res.arrayBuffer());
  assert.equal(kept.length, 120000, "a too-large post leaves the sharp still");
});

function tinyJpeg(tailByte) {
  return (
    "data:image/jpeg;base64," +
    Buffer.from([
      0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, tailByte,
    ]).toString("base64")
  );
}

test("server people keeps a name and a still for each console", async () => {
  const store = getStore({ name: "server-people", consistency: "strong" });
  let res = await serverPeople(
    post("http://x/api/server-people", {
      sid: "session-abcd",
      name: "  Ada\u0000  Lovelace the very long name  ",
    })
  );
  let d = await res.json();
  assert.equal(res.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(d.ok, true);
  assert.equal(d.people.length, 1);
  assert.equal(d.people[0].sid, "session-abcd");
  assert.equal(d.people[0].name, "Ada Lovelace the very long name");
  assert.equal(d.people[0].stillAt, 0);
  assert.equal(d.people[0].online, true);
  assert.equal(d.people[0].tab, "gallery");
  assert.equal(d.people[0].image, undefined);

  res = await serverPeople(
    post("http://x/api/server-people", { sid: "session-wxyz", name: "   ", tab: "Spellforge" })
  );
  d = await res.json();
  const guest = d.people.find((p) => p.sid === "session-wxyz");
  assert.equal(guest.name, "guest-wxyz");
  assert.equal(guest.tab, "spellforge");
  assert.equal(guest.online, true);

  res = await serverPeople(post("http://x/api/server-people", { sid: "short", name: "Nope" }));
  assert.equal(res.status, 400);

  const ada = tinyJpeg(12);
  const beau = tinyJpeg(13);
  res = await serverPeople(
    post("http://x/api/server-people", { sid: "session-abcd", name: "Ada", image: ada })
  );
  d = await res.json();
  assert.equal(res.status, 200);
  const adaRow = d.people.find((p) => p.sid === "session-abcd");
  assert.equal(adaRow.name, "Ada");
  assert.ok(adaRow.stillAt > 0);

  res = await serverPeople(
    post("http://x/api/server-people", { sid: "session-beau1", name: "Beau", image: beau })
  );
  assert.equal(res.status, 200);

  res = await serverPeople(
    post("http://x/api/server-people", { sid: "session-abcd", name: "Ada", image: "data:text/plain;base64,aGVsbG8=" })
  );
  assert.equal(res.status, 400);
  res = await serverPeople(new Request("http://x/api/server-people?image=1&sid=session-abcd"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  let buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(buf[buf.length - 1], 12, "a refused post leaves Ada's still");

  res = await serverPeople(new Request("http://x/api/server-people?image=1&sid=session-beau1"));
  buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(buf[buf.length - 1], 13, "Beau's still is separate");

  res = await serverPeople(
    post("http://x/api/server-people", { sid: "session-abcd", name: "Ada", to: "session-beau1", text: "  Hello <b>Beau</b>  " })
  );
  d = await res.json();
  assert.equal(res.status, 200);
  assert.equal(d.mail.length, 1);
  assert.equal(d.mail[0].text, "Hello Beau");
  assert.equal(d.mail[0].from, "session-abcd");
  assert.equal(d.mail[0].to, "session-beau1");
  res = await serverPeople(new Request("http://x/api/server-people?sid=session-beau1"));
  d = await res.json();
  assert.equal(d.mail.length, 1);
  assert.equal(d.mail[0].text, "Hello Beau");
  res = await serverPeople(new Request("http://x/api/server-people?sid=session-wxyz"));
  d = await res.json();
  assert.equal(d.mail.length, 0);

  res = await serverPeople(post("http://x/api/server-people", { sid: "session-beau1", leave: true }));
  d = await res.json();
  const left = d.people.find((p) => p.sid === "session-beau1");
  assert.ok(left);
  assert.equal(left.online, false);
  res = await serverPeople(new Request("http://x/api/server-people?image=1&sid=session-beau1"));
  assert.equal(res.status, 200);

  const now = Date.now();
  await store.set("still-session-old9", new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]));
  const roster = {
    "session-abcd": { name: "Ada", seen: now, stillAt: now, type: "image/jpeg" },
  };
  roster["session-old9"] = { name: "Old", seen: now - 120000, stillAt: now, type: "image/jpeg", tab: "gallery" };
  await store.setJSON("roster", roster);
  res = await serverPeople(new Request("http://x/api/server-people"));
  d = await res.json();
  const stale = d.people.find((p) => p.sid === "session-old9");
  assert.ok(stale);
  assert.equal(stale.online, false);
  res = await serverPeople(new Request("http://x/api/server-people?image=1&sid=session-old9"));
  assert.equal(res.status, 200);

  for (let i = 0; i < 130; i++) {
    const sid = "session-cap" + String(i).padStart(3, "0");
    roster[sid] = { name: "Cap " + i, seen: now - i - 1, stillAt: 0, type: "", tab: "gallery" };
  }
  await store.setJSON("roster", roster);
  res = await serverPeople(new Request("http://x/api/server-people"));
  d = await res.json();
  assert.equal(d.people.length, 120);
  assert.equal(d.people.some((p) => p.sid === "session-abcd"), true);
  assert.equal(d.people.some((p) => p.sid === "session-old9"), false);
  const gone = await store.get("still-session-old9", { type: "arrayBuffer" });
  assert.equal(gone, null);
});

test("deploy gate: previews always build, production needs [deploy]", () => {
  const msg = (m) => () => m;
  assert.equal(decide({ CONTEXT: "deploy-preview" }, msg("anything")).build, true);
  assert.equal(decide({ CONTEXT: "branch-deploy" }, msg("anything")).build, true);
  assert.equal(decide({ CONTEXT: "production" }, msg("Fix typo (#43)")).build, false);
  assert.equal(decide({ CONTEXT: "production" }, msg("Cut polling [deploy] (#43)")).build, true);
  assert.equal(
    decide({ CONTEXT: "production" }, msg("Cut polling (#43)\n\n* commit one\n\n[deploy]\n")).build,
    true,
    "tag in squash body"
  );
  assert.equal(decide({ CONTEXT: "production" }, msg("ship [DEPLOY]")).build, true);
  assert.equal(
    decide({ CONTEXT: "production" }, () => {
      throw new Error("no git");
    }).build,
    true,
    "fails open"
  );
  assert.equal(decide({}, msg("x")).build, true, "no CONTEXT (local) builds");
});
