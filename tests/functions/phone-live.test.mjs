import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext } from "@netlify/blobs";

let server;
let dir;
let phoneLive;

const PUB_A = "aaaaaaaaaaaaaaaa";
const PUB_B = "bbbbbbbbbbbbbbbb";

function jpegDataUrl() {
  const bytes = new Uint8Array(32);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[31] = 0xd9;
  return "data:image/jpeg;base64," + Buffer.from(bytes).toString("base64");
}

const post = (body) =>
  new Request("http://x/api/phone-live", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "phone-live-"));
  server = new BlobsServer({ directory: dir, token: "t0ken", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({ siteID: "site-phone-live", token: "t0ken", edgeURL: url, uncachedEdgeURL: url });
  phoneLive = (await import("../../netlify/functions/phone-live.mjs")).default;
});

test.after(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});

test("a camera frame is live for other screens and then turns off", async () => {
  let res = await phoneLive(new Request("http://x/api/phone-live"));
  let data = await res.json();
  assert.equal(data.live, false);

  res = await phoneLive(post({ image: jpegDataUrl(), publisher: PUB_A }));
  data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.live, true);
  assert.ok(data.at > 0);

  res = await phoneLive(new Request("http://x/api/phone-live"));
  data = await res.json();
  assert.equal(data.live, true);
  assert.equal(res.headers.get("cache-control"), "no-store, no-cache, must-revalidate");

  res = await phoneLive(new Request("http://x/api/phone-live?frame=1"));
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);

  res = await phoneLive(post({ image: jpegDataUrl(), publisher: PUB_B }));
  assert.equal(res.status, 409);

  res = await phoneLive(post({ off: true, publisher: PUB_A }));
  data = await res.json();
  assert.equal(data.live, false);
  res = await phoneLive(new Request("http://x/api/phone-live?frame=1"));
  assert.equal(res.status, 404);
});

test("a stale live picture can be replaced, and a bad frame is refused", async () => {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "phone-live", consistency: "strong" });
  await store.setJSON("meta", { at: Date.now() - 20000, publisher: PUB_A, on: true });
  let res = await phoneLive(post({ image: jpegDataUrl(), publisher: PUB_B }));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.live, true);

  res = await phoneLive(post({ image: "data:image/png;base64,aaaa", publisher: PUB_B }));
  assert.equal(res.status, 400);
  res = await phoneLive(post({ image: jpegDataUrl() }));
  assert.equal(res.status, 400);
});
