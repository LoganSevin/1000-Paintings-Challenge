#!/usr/bin/env node
// One-time migration: Netlify Blobs export -> SQL for the D1 blob store.
//
// 1. Export (Netlify CLI, site linked):  for each store/key
//      netlify blobs:get <store> <key> --output <dir>/<file>
//    plus <dir>/manifest.json = [{ store, key, file }, ...]
// 2. node cloudflare/import-netlify-blobs.mjs <dir> > blobs-import.sql
// 3. npx wrangler d1 execute logan7in-blobs --remote --file blobs-import.sql
//
// D1 caps one SQL statement at 100 KB, so values are split into ~60 KB chunks
// (cloudflare/blobs-d1.mjs reads any chunk size). Phone-upload files get their
// contentType/filename metadata back from the phone-uploads index.
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node cloudflare/import-netlify-blobs.mjs <export-dir> > import.sql");
  process.exit(1);
}
const SKIP_STORES = new Set(["spellforge-jobs"]); // transient job results
const CHUNK = 60_000;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8").replace(/^\uFEFF/, ""));
const rows = Array.isArray(manifest) ? manifest : [manifest];

const q = (s) => (s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
const isUtf8 = (buf) => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return !buf.includes(0);
  } catch (e) {
    return false;
  }
};

// contentType/filename for phone uploads, from the index blob.
const phoneMeta = {};
for (const r of rows) {
  if (r.store === "phone-uploads" && r.key === "index") {
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(dir, r.file), "utf8"));
      for (const it of (idx && idx.items) || []) {
        if (it && it.id) phoneMeta["file/" + it.id] = { contentType: it.contentType || "image/jpeg", filename: it.name || "" };
      }
    } catch (e) {}
  }
}

const out = [
  "CREATE TABLE IF NOT EXISTS blobs (store TEXT NOT NULL, key TEXT NOT NULL, etag TEXT NOT NULL, metadata TEXT, enc TEXT NOT NULL, size INTEGER NOT NULL, chunks INTEGER NOT NULL, data TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (store, key)) WITHOUT ROWID;",
  "CREATE TABLE IF NOT EXISTS blob_chunks (store TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (store, key, idx)) WITHOUT ROWID;",
];
let n = 0;
const now = Date.now();
for (const r of rows) {
  if (!r || !r.store || r.key == null || SKIP_STORES.has(r.store)) continue;
  if (r.store === "page-chat" && String(r.key).startsWith("rl/")) continue; // rate-limit stamps
  const file = path.join(dir, r.file);
  if (!fs.existsSync(file)) continue;
  const buf = fs.readFileSync(file);
  const binary = String(r.key).startsWith("file/") || !isUtf8(buf);
  const enc = binary ? "b64" : "utf8";
  const text = binary ? buf.toString("base64") : buf.toString("utf8");
  const meta = phoneMeta[r.key] ? JSON.stringify(phoneMeta[r.key]) : r.metadata ? JSON.stringify(r.metadata) : null;
  const etag = '"' + (r.etag ? String(r.etag).replace(/"/g, "") : "imp" + n) + '"';
  out.push(`DELETE FROM blob_chunks WHERE store = ${q(r.store)} AND key = ${q(r.key)};`);
  if (text.length <= CHUNK) {
    out.push(
      `INSERT OR REPLACE INTO blobs (store, key, etag, metadata, enc, size, chunks, data, updated_at) VALUES (${q(r.store)}, ${q(r.key)}, ${q(etag)}, ${q(meta)}, '${enc}', ${buf.length}, 0, ${q(text)}, ${now});`
    );
  } else {
    let i = 0;
    for (let o = 0; o < text.length; o += CHUNK, i++) {
      out.push(`INSERT INTO blob_chunks (store, key, idx, data) VALUES (${q(r.store)}, ${q(r.key)}, ${i}, ${q(text.slice(o, o + CHUNK))});`);
    }
    out.push(
      `INSERT OR REPLACE INTO blobs (store, key, etag, metadata, enc, size, chunks, data, updated_at) VALUES (${q(r.store)}, ${q(r.key)}, ${q(etag)}, ${q(meta)}, '${enc}', ${buf.length}, ${i}, NULL, ${now});`
    );
  }
  n++;
}
process.stdout.write(out.join("\n") + "\n");
console.error(`import SQL for ${n} blobs`);
