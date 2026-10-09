// Drop-in replacement for the parts of `@netlify/blobs` the site uses, on
// Cloudflare. wrangler.jsonc aliases "@netlify/blobs" to this file, so the
// functions in netlify/functions/ run unchanged on Cloudflare. (On Netlify the
// real package is used; this file is never loaded there.)
//
// Two interchangeable backends with the same schema:
//  - D1 (binding DB) when bound;
//  - otherwise a SQLite Durable Object (binding BLOBS, cloudflare/blobs-do.mjs),
//    which needs no extra API-token permission on the free plan.
// Why not KV: KV's free tier allows 1,000 writes/day and the tab-presence
// heartbeat alone writes every 10 s per open tab. Values are stored as TEXT
// (binary as base64) and split into ~900 KB chunks (a D1 row is capped at 2 MB).

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS blobs (store TEXT NOT NULL, key TEXT NOT NULL, etag TEXT NOT NULL, metadata TEXT, enc TEXT NOT NULL, size INTEGER NOT NULL, chunks INTEGER NOT NULL, data TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (store, key)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS blob_chunks (store TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (store, key, idx)) WITHOUT ROWID",
];

let DB = null;
let DO_NS = null;
let schemaReady = null;
export const CHUNK = 900_000;

/** D1 backend (also used by the tests with an in-memory SQLite). */
export function setBlobsDatabase(db) {
  if (db !== DB) {
    DB = db;
    schemaReady = null;
  }
  if (db) DO_NS = null;
}

/** Durable Object backend (namespace binding of BlobStoreDO). */
export function setBlobsDurableObject(ns) {
  DO_NS = ns || null;
  if (ns) DB = null;
}

/** Called by cloudflare/worker.mjs on every request. D1 wins when bound. */
export function setBlobsBackendFromEnv(env) {
  if (env && env.DB) {
    setBlobsDatabase(env.DB);
    return "d1";
  }
  if (env && env.BLOBS) {
    setBlobsDurableObject(env.BLOBS);
    return "durable-object";
  }
  DB = null;
  DO_NS = null;
  return "missing";
}

// A new stub per call: Workers forbid reusing I/O objects across requests.
function doStub() {
  return DO_NS.get(DO_NS.idFromName("blobs"));
}

function db() {
  if (!DB) throw new Error("Blob storage is not configured (missing D1 binding DB or Durable Object binding BLOBS).");
  return DB;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = db()
      .batch(SCHEMA.map((sql) => db().prepare(sql)))
      .catch((e) => {
        schemaReady = null;
        throw e;
      });
  }
  return schemaReady;
}

function newEtag() {
  return '"' + crypto.randomUUID().replace(/-/g, "") + '"';
}

const te = new TextEncoder();
const td = new TextDecoder();

function toBase64(u8) {
  if (typeof Buffer !== "undefined") return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString("base64");
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s) {
  if (typeof Buffer !== "undefined") {
    const b = Buffer.from(s, "base64");
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encodeValue(value) {
  if (typeof value === "string") return { enc: "utf8", text: value, size: te.encode(value).length };
  let u8;
  if (value instanceof Uint8Array) u8 = value;
  else if (value instanceof ArrayBuffer) u8 = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) u8 = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else if (typeof Blob !== "undefined" && value instanceof Blob) u8 = new Uint8Array(await value.arrayBuffer());
  else throw new TypeError("Unsupported blob value type");
  return { enc: "b64", text: toBase64(u8), size: u8.byteLength };
}

function decodeValue(row, text, type) {
  const isB64 = row.enc === "b64";
  if (!type || type === "text") return isB64 ? td.decode(fromBase64(text)) : text;
  if (type === "json") return JSON.parse(isB64 ? td.decode(fromBase64(text)) : text);
  const u8 = isB64 ? fromBase64(text) : te.encode(text);
  if (type === "arrayBuffer") return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  if (type === "blob") return new Blob([u8]);
  if (type === "stream") return new Blob([u8]).stream();
  throw new TypeError("Unsupported get type: " + type);
}

function parseMeta(s) {
  if (!s) return {};
  try {
    return JSON.parse(s) || {};
  } catch (e) {
    return {};
  }
}

class D1Store {
  constructor(name) {
    this.name = String(name || "default");
  }

  async _row(key) {
    await ensureSchema();
    return db()
      .prepare("SELECT etag, metadata, enc, size, chunks, data FROM blobs WHERE store = ? AND key = ?")
      .bind(this.name, String(key))
      .first();
  }

  async _text(key, row) {
    if (!row.chunks) return row.data || "";
    const res = await db()
      .prepare("SELECT data FROM blob_chunks WHERE store = ? AND key = ? ORDER BY idx")
      .bind(this.name, String(key))
      .all();
    return (res.results || []).map((r) => r.data).join("");
  }

  async get(key, opts = {}) {
    const row = await this._row(key);
    if (!row) return null;
    return decodeValue(row, await this._text(key, row), opts && opts.type);
  }

  async getWithMetadata(key, opts = {}) {
    const row = await this._row(key);
    if (!row) return null;
    const data = decodeValue(row, await this._text(key, row), opts && opts.type);
    return { data, etag: row.etag, metadata: parseMeta(row.metadata) };
  }

  async getMetadata(key) {
    const row = await this._row(key);
    if (!row) return null;
    return { etag: row.etag, metadata: parseMeta(row.metadata) };
  }

  async set(key, value, opts = {}) {
    await ensureSchema();
    const k = String(key);
    const { enc, text, size } = await encodeValue(value);
    const etag = newEtag();
    const meta = opts && opts.metadata ? JSON.stringify(opts.metadata) : null;
    const now = Date.now();
    const chunked = text.length > CHUNK;
    const parts = [];
    if (chunked) for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
    const inline = chunked ? null : text;
    const nChunks = parts.length;

    let head;
    if (opts && opts.onlyIfNew) {
      head = db()
        .prepare(
          "INSERT INTO blobs (store, key, etag, metadata, enc, size, chunks, data, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (store, key) DO NOTHING"
        )
        .bind(this.name, k, etag, meta, enc, size, nChunks, inline, now);
    } else if (opts && opts.onlyIfMatch) {
      head = db()
        .prepare(
          "UPDATE blobs SET etag = ?, metadata = ?, enc = ?, size = ?, chunks = ?, data = ?, updated_at = ? WHERE store = ? AND key = ? AND etag = ?"
        )
        .bind(etag, meta, enc, size, nChunks, inline, now, this.name, k, String(opts.onlyIfMatch));
    } else {
      head = db()
        .prepare(
          "INSERT INTO blobs (store, key, etag, metadata, enc, size, chunks, data, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (store, key) DO UPDATE SET etag = excluded.etag, metadata = excluded.metadata, enc = excluded.enc, size = excluded.size, chunks = excluded.chunks, data = excluded.data, updated_at = excluded.updated_at"
        )
        .bind(this.name, k, etag, meta, enc, size, nChunks, inline, now);
    }

    const conditional = !!(opts && (opts.onlyIfNew || opts.onlyIfMatch));
    if (!chunked) {
      // Small value: one statement (plus clearing stale chunks only if needed).
      const clear = db().prepare("DELETE FROM blob_chunks WHERE store = ? AND key = ?").bind(this.name, k);
      if (!conditional) {
        await db().batch([head, clear]);
        return { modified: true, etag };
      }
      const res = await head.run();
      const modified = !!(res.meta && res.meta.changes > 0);
      if (modified) await clear.run();
      return { modified, etag: modified ? etag : undefined };
    }

    const res = await head.run();
    const modified = !conditional || (res.meta && res.meta.changes > 0);
    if (!modified) return { modified: false };
    const stmts = [db().prepare("DELETE FROM blob_chunks WHERE store = ? AND key = ?").bind(this.name, k)];
    parts.forEach((p, i) =>
      stmts.push(db().prepare("INSERT INTO blob_chunks (store, key, idx, data) VALUES (?,?,?,?)").bind(this.name, k, i, p))
    );
    await db().batch(stmts);
    return { modified: true, etag };
  }

  async setJSON(key, value, opts = {}) {
    return this.set(key, JSON.stringify(value), opts);
  }

  async delete(key) {
    await ensureSchema();
    const k = String(key);
    await db().batch([
      db().prepare("DELETE FROM blobs WHERE store = ? AND key = ?").bind(this.name, k),
      db().prepare("DELETE FROM blob_chunks WHERE store = ? AND key = ?").bind(this.name, k),
    ]);
  }

  async list(opts = {}) {
    await ensureSchema();
    const prefix = String((opts && opts.prefix) || "");
    const res = await db()
      .prepare("SELECT key, etag FROM blobs WHERE store = ? AND substr(key, 1, ?) = ? ORDER BY key")
      .bind(this.name, prefix.length, prefix)
      .all();
    const blobs = (res.results || []).map((r) => ({ key: r.key, etag: r.etag }));
    if (!opts || !opts.directories) return { blobs, directories: [] };
    const dirs = new Set();
    const flat = [];
    for (const b of blobs) {
      const rest = b.key.slice(prefix.length);
      const i = rest.indexOf("/");
      if (i >= 0) dirs.add(prefix + rest.slice(0, i));
      else flat.push(b);
    }
    return { blobs: flat, directories: [...dirs] };
  }
}

class DOStore {
  constructor(name) {
    this.name = String(name || "default");
  }

  async _read(key) {
    return doStub().read(this.name, String(key));
  }

  async get(key, opts = {}) {
    const r = await this._read(key);
    if (!r) return null;
    return decodeValue(r, r.text, opts && opts.type);
  }

  async getWithMetadata(key, opts = {}) {
    const r = await this._read(key);
    if (!r) return null;
    return { data: decodeValue(r, r.text, opts && opts.type), etag: r.etag, metadata: parseMeta(r.metadata) };
  }

  async getMetadata(key) {
    const r = await this._read(key);
    if (!r) return null;
    return { etag: r.etag, metadata: parseMeta(r.metadata) };
  }

  async set(key, value, opts = {}) {
    const { enc, text, size } = await encodeValue(value);
    const etag = newEtag();
    const parts = [];
    if (text.length > CHUNK) for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
    else parts.push(text);
    const metadata = opts && opts.metadata ? JSON.stringify(opts.metadata) : null;
    const cond = {};
    if (opts && opts.onlyIfNew) cond.onlyIfNew = true;
    if (opts && opts.onlyIfMatch) cond.onlyIfMatch = String(opts.onlyIfMatch);
    const modified = await doStub().write(this.name, String(key), { etag, metadata, enc, size, parts }, cond);
    return modified ? { modified: true, etag } : { modified: false };
  }

  async setJSON(key, value, opts = {}) {
    return this.set(key, JSON.stringify(value), opts);
  }

  async delete(key) {
    await doStub().del(this.name, String(key));
  }

  async list(opts = {}) {
    const prefix = String((opts && opts.prefix) || "");
    const blobs = await doStub().list(this.name, prefix);
    return splitDirs(blobs, prefix, opts);
  }
}

function splitDirs(blobs, prefix, opts) {
  if (!opts || !opts.directories) return { blobs, directories: [] };
  const dirs = new Set();
  const flat = [];
  for (const b of blobs) {
    const rest = b.key.slice(prefix.length);
    const i = rest.indexOf("/");
    if (i >= 0) dirs.add(prefix + rest.slice(0, i));
    else flat.push(b);
  }
  return { blobs: flat, directories: [...dirs] };
}

export function getStore(input) {
  const name = typeof input === "string" ? input : input && input.name;
  return DO_NS && !DB ? new DOStore(name) : new D1Store(name);
}

export function getDeployStore(input) {
  return getStore(input || { name: "deploy" });
}

export function connectLambda() {}
