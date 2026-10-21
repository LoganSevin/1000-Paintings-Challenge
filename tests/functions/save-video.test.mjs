import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext } from "@netlify/blobs";
import {
  remoteUrlError,
  sniffVideo,
  planByteRange,
  FULL_MAX_BYTES,
  SLICE_BYTES,
  MAX_VIDEO_BYTES,
  setRemoteFetchForTests,
  storeClip,
  STORE_NAME,
} from "../../netlify/functions/save-video.mjs";

let server;
let dir;
let saveVideo;
let savedVideo;

function mp4(n = 64) {
  const u = new Uint8Array(n);
  const head = Buffer.from("\0\0\0\x18ftypisom");
  u.set(head.subarray(0, Math.min(head.length, u.length)));
  return u;
}

function webm(n = 32) {
  const u = new Uint8Array(n);
  u[0] = 0x1a;
  u[1] = 0x45;
  u[2] = 0xdf;
  u[3] = 0xa3;
  return u;
}

function post(body) {
  return new Request("http://x/api/save-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("public https is allowed and private or non-https addresses are refused", () => {
  assert.equal(remoteUrlError("https://cdn.example/clip.mp4"), "");
  for (const url of [
    "http://cdn.example/clip.mp4",
    "https://127.0.0.1/clip.mp4",
    "https://localhost/clip.mp4",
    "https://10.1.2.3/clip.mp4",
    "https://192.168.0.8/clip.mp4",
    "https://172.16.0.4/clip.mp4",
    "https://169.254.169.254/latest",
    "https://user:pass@cdn.example/clip.mp4",
    "blob:https://logan7in.art/1111",
    "data:video/mp4;base64,AAAA",
  ]) {
    assert.ok(remoteUrlError(url), url);
  }
});

test("mp4 and webm headers are recognized", () => {
  assert.equal(sniffVideo(mp4()), "mp4");
  assert.equal(sniffVideo(webm()), "webm");
  assert.equal(sniffVideo(Buffer.from("hello world!!!!")), "");
});

test("a short file is returned whole and a long file is sliced", () => {
  const small = planByteRange(1000, "");
  assert.equal(small.status, 200);
  assert.equal(small.end, 999);
  const big = planByteRange(FULL_MAX_BYTES + 10, "");
  assert.equal(big.status, 206);
  assert.equal(big.start, 0);
  assert.equal(big.end, SLICE_BYTES - 1);
  const mid = planByteRange(FULL_MAX_BYTES + 10, "bytes=100-");
  assert.equal(mid.status, 206);
  assert.equal(mid.start, 100);
  assert.equal(mid.end - mid.start + 1, SLICE_BYTES);
  assert.equal(planByteRange(1000, "bytes=5000-").error, 416);
});

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), "save-video-"));
  server = new BlobsServer({ directory: dir, token: "t0ken", port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  setEnvironmentContext({
    siteID: "site-save-video",
    token: "t0ken",
    edgeURL: url,
    uncachedEdgeURL: url,
  });
  saveVideo = (await import("../../netlify/functions/save-video.mjs")).default;
  savedVideo = (await import("../../netlify/functions/saved-video.mjs")).default;
});

test.after(async () => {
  setRemoteFetchForTests(null);
  if (server) await server.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("a remote clip is stored, served in ranges, and a private redirect is refused", async () => {
  let hits = 0;
  setRemoteFetchForTests(async () => {
    hits += 1;
    return new Response(mp4(80), { status: 200 });
  });
  let res = await saveVideo(post({ url: "https://cdn.example/clip.mp4", force_mp4: true }));
  let data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.num, 1);
  assert.equal(data.name, "1.mp4");
  assert.equal(data.url, "/saved-videos/1.mp4");
  assert.equal(data.path, "saved-videos/1.mp4");
  assert.equal(data.bytes, 80);
  assert.equal(hits, 1);

  res = await savedVideo(new Request("http://x/saved-videos/1.mp4"));
  const body = new Uint8Array(await res.arrayBuffer());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "video/mp4");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(body.length, 80);
  assert.equal(body[4], "f".charCodeAt(0));

  res = await savedVideo(
    new Request("http://x/saved-videos/1.mp4", { headers: { range: "bytes=4-7" } })
  );
  const slice = new Uint8Array(await res.arrayBuffer());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 4-7/80");
  assert.equal(Buffer.from(slice).toString("latin1"), "ftyp");

  hits = 0;
  res = await saveVideo(post({ url: "https://cdn.example/saved-videos/1.mp4" }));
  data = await res.json();
  assert.equal(data.already_saved, true);
  assert.equal(data.name, "1.mp4");
  assert.equal(hits, 0);

  res = await saveVideo(post({ url: "https://logan7in.art/saved-videos/99.mp4" }));
  assert.equal(res.status, 404);

  setRemoteFetchForTests(async () => new Response(webm(), { status: 200 }));
  res = await saveVideo(post({ url: "https://cdn.example/clip.webm", force_mp4: true }));
  data = await res.json();
  assert.equal(data.name, "2.webm");
  assert.equal(data.content_type, "video/webm");

  let redirected = 0;
  setRemoteFetchForTests(async (url) => {
    if (String(url).includes("127.0.0.1")) redirected += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/evil.mp4" },
    });
  });
  res = await saveVideo(post({ url: "https://cdn.example/bounce.mp4" }));
  assert.equal(res.status, 400);
  assert.equal(redirected, 0);

  setRemoteFetchForTests(async () => {
    throw new Error("should not fetch");
  });
  res = await saveVideo(post({ url: "https://10.2.3.4/secret.mp4" }));
  assert.equal(res.status, 400);

  setRemoteFetchForTests(async () => {
    return new Response(new Uint8Array(8), {
      status: 200,
      headers: { "content-length": String(MAX_VIDEO_BYTES + 1024) },
    });
  });
  res = await saveVideo(post({ url: "https://cdn.example/huge.mp4" }));
  assert.equal(res.status, 413);

  setRemoteFetchForTests(async () => new Response(Buffer.from("not a video!!"), { status: 200 }));
  res = await saveVideo(post({ url: "https://cdn.example/notes.txt" }));
  assert.equal(res.status, 415);

  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const big = mp4(FULL_MAX_BYTES + 32);
  big[SLICE_BYTES] = 0x5a;
  const stored = await storeClip(store, big, "mp4");
  res = await savedVideo(new Request("http://x/saved-videos/" + stored.name));
  const part = new Uint8Array(await res.arrayBuffer());
  assert.equal(res.status, 206);
  assert.equal(part.length, SLICE_BYTES);
  assert.equal(res.headers.get("content-range"), "bytes 0-" + (SLICE_BYTES - 1) + "/" + big.length);
  assert.equal(part[4], "f".charCodeAt(0));
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("vary"), "Range");

  const parts = [];
  for (let start = 0; start < big.length; start += SLICE_BYTES) {
    const end = Math.min(big.length - 1, start + SLICE_BYTES - 1);
    const ranged = await savedVideo(
      new Request("http://x/saved-videos/" + stored.name, {
        headers: { range: "bytes=" + start + "-" + end },
      })
    );
    assert.equal(ranged.status, 206);
    parts.push(Buffer.from(await ranged.arrayBuffer()));
  }
  const joined = Buffer.concat(parts);
  assert.equal(joined.length, big.length);
  assert.equal(joined[SLICE_BYTES], 0x5a);
  assert.equal(joined[4], "f".charCodeAt(0));

  const listed = await saveVideo(new Request("http://x/api/saved-videos", { method: "GET" }));
  const listData = await listed.json();
  assert.equal(listed.status, 200);
  assert.equal(listData.ok, true);
  assert.equal(listData.items.some((item) => item.name === stored.name && item.bytes === big.length), true);
});
