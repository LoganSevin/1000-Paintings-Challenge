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

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "blobs-"));
  server = new BlobsServer({ directory: dir, token: "t0ken", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site-1", token: "t0ken", edgeURL: url, uncachedEdgeURL: url });
  checkin = (await import("../../netlify/functions/gallery-checkin.mjs")).default;
  presence = (await import("../../netlify/functions/presence.mjs")).default;
  serverWindow = (await import("../../netlify/functions/server-window.mjs")).default;
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
