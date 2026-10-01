// Serves JSON collections that would push the static upload over the free
// plan's 20,000-file limit (sketches-meta/, generated-meta/, sketches/json/ —
// ~14k small files). cloudflare/build.mjs concatenates them into a few
// cf-packs/<collection>/<n>.bin files plus index.json; this module answers the
// original URLs (/sketches-meta/12.json, ...) from those packs, byte-for-byte.
export const PACKS = {
  "/sketches-meta/": "sketches-meta",
  "/generated-meta/": "generated-meta",
  "/sketches/json/": "sketches-json",
};
export const PACKED_PREFIXES = Object.keys(PACKS);

const indexes = new Map();

async function loadIndex(env, origin, coll) {
  if (indexes.has(coll)) return indexes.get(coll);
  const p = (async () => {
    const res = await env.ASSETS.fetch(new Request(origin + "/cf-packs/" + coll + "/index.json"));
    if (!res.ok) throw new Error("pack index missing: " + coll);
    return res.json();
  })();
  indexes.set(coll, p);
  p.catch(() => indexes.delete(coll));
  return p;
}

function typeFor(name) {
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export async function servePacked(request, env, url, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const prefix = PACKED_PREFIXES.find((p) => url.pathname.startsWith(p));
  const coll = PACKS[prefix];
  let name;
  try {
    name = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch (e) {
    return new Response("Not found", { status: 404 });
  }
  let index;
  try {
    index = await loadIndex(env, url.origin, coll);
  } catch (e) {
    return new Response("Not found", { status: 404 });
  }
  const entry = index.files && index.files[name];
  if (!entry) return new Response("Not found", { status: 404 });
  const [pack, offset, length] = entry;
  const packUrl = url.origin + "/cf-packs/" + coll + "/" + pack + ".bin";
  const res = await env.ASSETS.fetch(
    new Request(packUrl, { headers: { Range: "bytes=" + offset + "-" + (offset + length - 1) } })
  );
  if (!res.ok) return new Response("Not found", { status: 404 });
  let body;
  if (res.status === 206) {
    body = await res.arrayBuffer();
  } else {
    const all = await res.arrayBuffer();
    body = all.slice(offset, offset + length);
  }
  const headers = {
    "Content-Type": typeFor(name),
    "Cache-Control": "public, max-age=3600",
    "Content-Length": String(body.byteLength),
    "Access-Control-Allow-Origin": "*",
  };
  if (index.etags && index.etags[name]) headers.ETag = index.etags[name];
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}
