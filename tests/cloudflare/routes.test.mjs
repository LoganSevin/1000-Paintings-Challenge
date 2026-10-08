// node tests/cloudflare/routes.test.mjs
// Keeps cloudflare/worker.mjs in step with netlify/functions + netlify.toml, so a
// new function added for Netlify is not silently missing on Cloudflare.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const worker = fs.readFileSync(path.join(ROOT, "cloudflare/worker.mjs"), "utf8");
const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");

test("every Netlify function is registered in the Worker", () => {
  const fns = fs
    .readdirSync(path.join(ROOT, "netlify/functions"))
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("_"))
    .map((f) => f.slice(0, -4));
  for (const fn of fns) {
    assert.ok(worker.includes(`"../netlify/functions/${fn}.mjs"`), `${fn} not imported in cloudflare/worker.mjs`);
  }
});

test("every netlify.toml /api redirect has a Worker route", () => {
  const re = /from = "(\/api\/[^"]+)"\s*\n\s*to = "\/\.netlify\/functions\/([a-z0-9-]+)/g;
  for (const [, from, fn] of toml.matchAll(re)) {
    assert.ok(worker.includes(`["${from}", "${fn}"]`), `route ${from} -> ${fn} missing in cloudflare/worker.mjs`);
  }
});
