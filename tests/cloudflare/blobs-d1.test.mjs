// node --experimental-sqlite tests/cloudflare/blobs-d1.test.mjs   (Node >= 22.5)
// Exercises cloudflare/blobs-d1.mjs against an in-memory SQLite that mimics the D1 binding.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { setBlobsDatabase, getStore } from "../../cloudflare/blobs-d1.mjs";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
  };
}

test("text/json/binary round trips, metadata, missing keys", async () => {
  setBlobsDatabase(fakeD1());
  const s = getStore({ name: "page-chat", consistency: "strong" });
  assert.equal(await s.get("nope", { type: "json" }), null);
  assert.equal(await s.getWithMetadata("nope"), null);
  await s.setJSON("room/gallery", [{ id: 1, text: "hi ✨" }]);
  assert.deepEqual(await s.get("room/gallery", { type: "json" }), [{ id: 1, text: "hi ✨" }]);
  assert.equal(await s.get("room/gallery"), '[{"id":1,"text":"hi ✨"}]');
  const bin = new Uint8Array([0xff, 0xd8, 0, 1, 2, 250]);
  await s.set("file/x", bin, { metadata: { contentType: "image/jpeg" } });
  const m = await s.getWithMetadata("file/x", { type: "arrayBuffer" });
  assert.deepEqual(new Uint8Array(m.data), bin);
  assert.equal(m.metadata.contentType, "image/jpeg");
  assert.ok(m.etag);
  // stores are isolated
  assert.equal(await getStore("other").get("room/gallery"), null);
});

test("large values are chunked and reassembled; overwrite with small clears chunks", async () => {
  setBlobsDatabase(fakeD1());
  const s = getStore("phone-uploads");
  const big = new Uint8Array(2_500_000).map((_, i) => (i * 31) & 255);
  await s.set("file/big", big);
  assert.deepEqual(new Uint8Array(await s.get("file/big", { type: "arrayBuffer" })), big);
  const bigText = "x".repeat(1_950_000);
  await s.set("t", bigText);
  assert.equal(await s.get("t"), bigText);
  await s.set("t", "small");
  assert.equal(await s.get("t"), "small");
});

test("onlyIfNew / onlyIfMatch conditional writes", async () => {
  setBlobsDatabase(fakeD1());
  const s = getStore("phone-uploads");
  const a = await s.setJSON("index", { items: [1] }, { onlyIfNew: true });
  assert.equal(a.modified, true);
  const b = await s.setJSON("index", { items: [2] }, { onlyIfNew: true });
  assert.equal(b.modified, false);
  const cur = await s.getWithMetadata("index", { type: "json" });
  assert.deepEqual(cur.data, { items: [1] });
  const stale = await s.setJSON("index", { items: [3] }, { onlyIfMatch: '"wrong"' });
  assert.equal(stale.modified, false);
  const ok = await s.setJSON("index", { items: [4] }, { onlyIfMatch: cur.etag });
  assert.equal(ok.modified, true);
  assert.deepEqual(await s.get("index", { type: "json" }), { items: [4] });
});

test("list with prefix, delete", async () => {
  setBlobsDatabase(fakeD1());
  const s = getStore("page-chat");
  await s.set("room/a", "1");
  await s.set("room/b", "2");
  await s.set("rl/1.2.3.4", "3");
  assert.deepEqual((await s.list({ prefix: "room/" })).blobs.map((b) => b.key), ["room/a", "room/b"]);
  await s.delete("room/a");
  assert.equal(await s.get("room/a"), null);
  assert.equal((await s.list()).blobs.length, 2);
});
