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

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "blobs-"));
  server = new BlobsServer({ directory: dir, token: "t0ken", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site-1", token: "t0ken", edgeURL: url, uncachedEdgeURL: url });
  checkin = (await import("../../netlify/functions/gallery-checkin.mjs")).default;
  presence = (await import("../../netlify/functions/presence.mjs")).default;
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
