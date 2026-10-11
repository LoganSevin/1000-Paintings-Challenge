// node --test tests/functions/online-users.test.mjs
// Online list: names + last still on the presence record, per-visitor stills in server-window.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext } from "@netlify/blobs";

let server;
let dir;
let presence;
let serverWindow;
let online;

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "blobs-"));
  server = new BlobsServer({ directory: dir, token: "t0ken", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site-1", token: "t0ken", edgeURL: url, uncachedEdgeURL: url });
  presence = (await import("../../netlify/functions/presence.mjs")).default;
  serverWindow = (await import("../../netlify/functions/server-window.mjs")).default;
  online = await import("../../netlify/functions/_online.mjs");
});

test.after(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});

const post = (url, body) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const jpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).toString("base64");

test("cleanName strips markup, invisible characters and caps the length", () => {
  assert.equal(online.cleanName("  Velvet\u200b <b>Monet</b>\n "), "Velvet bMonet/b");
  assert.equal(online.cleanName("x".repeat(80)).length, online.NAME_MAX);
  assert.equal(online.cleanName("\u202e\u0000"), "");
});

test("presence carries names; the list uses public ids, never the session id", async () => {
  let d = await (await presence(post("http://x/api/presence", { sid: "session-aaaa1111", tab: "gallery", name: "Amber Monet" }))).json();
  assert.ok(online.isPid(d.you));
  assert.equal(d.you, await online.pidOf("session-aaaa1111"));
  d = await (await presence(post("http://x/api/presence", { sid: "session-bbbb2222", tab: "objects", name: "" }))).json();
  assert.equal(d.users.length, 2);
  assert.deepEqual(d.users.map((u) => u.name), ["Amber Monet", "guest"]);
  assert.ok(!JSON.stringify(d).includes("session-aaaa1111"), "sid not exposed");
  // rename keeps the arrival order
  d = await (await presence(post("http://x/api/presence", { sid: "session-aaaa1111", tab: "spellforge", name: "Logan" }))).json();
  assert.equal(d.users[0].name, "Logan");
  assert.equal(d.users[0].tab, "spellforge");
  d = await (await presence(new Request("http://x/api/presence"))).json();
  assert.equal(d.users.length, 2);
  assert.equal(d.you, undefined);
});

test("server-window keeps each visitor's last still with the name they used", async () => {
  let res = await serverWindow(post("http://x/api/server-window", { image: jpeg, tab: "objects", sid: "session-aaaa1111", name: "Logan", prompt: "glowing lantern" }));
  let d = await res.json();
  assert.equal(d.ok, true);
  assert.equal(d.last.tab, "objects", "shared window still updated as before");
  assert.equal(d.user_last.name, "Logan");
  assert.equal(d.user_last.image, true);
  const pid = await online.pidOf("session-aaaa1111");

  // the page echoes user_last on its next beat
  d = await (await presence(post("http://x/api/presence", { sid: "session-aaaa1111", tab: "objects", name: "Logan Sevin", last: d.user_last }))).json();
  const me = d.users.find((u) => u.id === pid);
  assert.equal(me.name, "Logan Sevin");
  assert.equal(me.last.name, "Logan", "name at generation time kept");
  // a beat without last keeps it
  d = await (await presence(post("http://x/api/presence", { sid: "session-aaaa1111", tab: "gallery", name: "Logan Sevin" }))).json();
  assert.ok(d.users.find((u) => u.id === pid).last);

  // window poll lists users too
  d = await (await serverWindow(new Request("http://x/api/server-window"))).json();
  assert.equal(d.users.find((u) => u.id === pid).last.tab, "objects");

  res = await serverWindow(new Request(`http://x/api/server-window?user=${pid}&image=1&v=1`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.match(res.headers.get("cache-control"), /max-age/);
  d = await (await serverWindow(new Request(`http://x/api/server-window?user=${pid}`))).json();
  assert.equal(d.last.prompt, "glowing lantern");

  res = await serverWindow(new Request(`http://x/api/server-window?user=${await online.pidOf("session-bbbb2222")}&image=1`));
  assert.equal(res.status, 404);
  res = await serverWindow(new Request("http://x/api/server-window?user=../../etc&image=1"));
  assert.equal(res.status, 400);
});

test("a posted remote still replaces the stored image; old pages still work without sid", async () => {
  const pid = await online.pidOf("session-aaaa1111");
  let d = await (await serverWindow(post("http://x/api/server-window", { remote: "https://example.com/a.jpg", tab: "zoo", sid: "session-aaaa1111", name: "Logan" }))).json();
  assert.equal(d.user_last.remote, "https://example.com/a.jpg");
  const res = await serverWindow(new Request(`http://x/api/server-window?user=${pid}&image=1`));
  assert.equal(res.status, 404);
  d = await (await serverWindow(post("http://x/api/server-window", { image: jpeg, tab: "gallery" }))).json();
  assert.equal(d.ok, true);
  assert.equal(d.user_last, undefined);
});

test("bogus last stills are refused", () => {
  assert.equal(online.cleanLast({ at: Date.now(), remote: "javascript:alert(1)" }), null);
  assert.equal(online.cleanLast({ at: Date.now() + 3600e3, image: true }), null);
  assert.equal(online.cleanLast({ at: Date.now(), remote: 'https://x.y/"onerror' }), null);
  assert.equal(online.cleanLast({ at: Date.now(), image: true, name: "<i>" }).name, "i");
});
