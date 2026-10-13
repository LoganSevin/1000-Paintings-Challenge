// node tests/diction-numbers.test.js — checks Dictionary numbering against data/diction/*.txt
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = path.join(__dirname, "..");
const ctx = { window: { addEventListener() {} }, document: { readyState: "complete", getElementById: () => null, addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/diction.js"), "utf8"), ctx);
const { buildNumbers, parseNumberQuery, wordAt } = ctx.window.Diction._num;
const out = [];
for (const ch of "abcdefghijklmnopqrstuvwxyz") {
  const raw = fs.readFileSync(path.join(root, "data/diction", ch + ".txt"), "utf8");
  const rows = raw.split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
  const lines = raw.split("\n").filter((l) => l.length).length;
  assert.strictEqual(rows.length, lines, ch + " count");
  const nums = buildNumbers(rows);
  assert.strictEqual(Object.keys(nums).length, rows.length, ch + " unique");
  rows.forEach((w, i) => { assert.strictEqual(nums[w], i + 1); assert.strictEqual(wordAt(rows, i + 1), w); });
  assert.strictEqual(wordAt(rows, 0), ""); assert.strictEqual(wordAt(rows, rows.length + 1), "");
  assert.ok(rows.every((w) => w[0] === ch), ch + " first letter");
  out.push(`${ch.toUpperCase()}=${rows.length} (#1 ${rows[0]}, #152 ${wordAt(rows,152)}, #${rows.length} ${rows[rows.length-1]})`);
}
const t = (q, l, n) => { const r = parseNumberQuery(q); assert.ok(r, q); assert.strictEqual(r.letter, l); assert.strictEqual(r.n, n); };
t("152", "", 152); t("#152", "", 152); t("B 152", "b", 152); t("b152", "b", 152); t(" q #7 ", "q", 7);
assert.strictEqual(parseNumberQuery("bat"), null); assert.strictEqual(parseNumberQuery("b 1 2"), null);
console.log(out.join("\n")); console.log("ok");
