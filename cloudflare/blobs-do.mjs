// SQLite-backed Durable Object that stores the Netlify Blobs data on Cloudflare
// when no D1 database is bound (free plan, no extra API permission needed).
// cloudflare/blobs-d1.mjs talks to one instance ("blobs") over RPC; the schema
// is the same as the D1 one, so the data model and chunking are identical.
import { DurableObject } from "cloudflare:workers";
import { SCHEMA } from "./blobs-d1.mjs";

export class BlobStoreDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const s of SCHEMA) this.sql.exec(s);
  }

  read(store, key) {
    const row = this.sql
      .exec("SELECT etag, metadata, enc, size, chunks, data FROM blobs WHERE store = ? AND key = ?", store, key)
      .toArray()[0];
    if (!row) return null;
    let text = row.data || "";
    if (row.chunks) {
      text = this.sql
        .exec("SELECT data FROM blob_chunks WHERE store = ? AND key = ? ORDER BY idx", store, key)
        .toArray()
        .map((r) => r.data)
        .join("");
    }
    return { etag: row.etag, metadata: row.metadata, enc: row.enc, size: row.size, text };
  }

  /** rec = { etag, metadata, enc, size, parts: string[] } (one part = inline). */
  write(store, key, rec, cond = {}) {
    return this.ctx.storage.transactionSync(() => {
      const chunked = rec.parts.length > 1;
      const inline = chunked ? null : rec.parts[0] || "";
      const n = chunked ? rec.parts.length : 0;
      const now = Date.now();
      const args = [rec.etag, rec.metadata, rec.enc, rec.size, n, inline, now];
      let cur;
      if (cond.onlyIfNew) {
        cur = this.sql.exec(
          "INSERT INTO blobs (store, key, etag, metadata, enc, size, chunks, data, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (store, key) DO NOTHING",
          store, key, ...args
        );
      } else if (cond.onlyIfMatch) {
        cur = this.sql.exec(
          "UPDATE blobs SET etag = ?, metadata = ?, enc = ?, size = ?, chunks = ?, data = ?, updated_at = ? WHERE store = ? AND key = ? AND etag = ?",
          ...args, store, key, String(cond.onlyIfMatch)
        );
      } else {
        cur = this.sql.exec(
          "INSERT INTO blobs (store, key, etag, metadata, enc, size, chunks, data, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (store, key) DO UPDATE SET etag = excluded.etag, metadata = excluded.metadata, enc = excluded.enc, size = excluded.size, chunks = excluded.chunks, data = excluded.data, updated_at = excluded.updated_at",
          store, key, ...args
        );
      }
      cur.toArray();
      if ((cond.onlyIfNew || cond.onlyIfMatch) && !cur.rowsWritten) return false;
      this.sql.exec("DELETE FROM blob_chunks WHERE store = ? AND key = ?", store, key);
      if (chunked) {
        rec.parts.forEach((p, i) =>
          this.sql.exec("INSERT INTO blob_chunks (store, key, idx, data) VALUES (?,?,?,?)", store, key, i, p)
        );
      }
      return true;
    });
  }

  del(store, key) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM blobs WHERE store = ? AND key = ?", store, key);
      this.sql.exec("DELETE FROM blob_chunks WHERE store = ? AND key = ?", store, key);
    });
  }

  list(store, prefix) {
    return this.sql
      .exec("SELECT key, etag FROM blobs WHERE store = ? AND substr(key, 1, ?) = ? ORDER BY key", store, prefix.length, prefix)
      .toArray()
      .map((r) => ({ key: r.key, etag: r.etag }));
  }
}
