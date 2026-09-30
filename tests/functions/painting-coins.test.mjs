import assert from "node:assert/strict";
import test from "node:test";
import { handleCoins, scopeFor } from "../../netlify/functions/painting-coins.mjs";
import CoinMath from "../../js/painting-coins-math.js";

const M = CoinMath && CoinMath.quote ? CoinMath : CoinMath.default;

function memStore() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? JSON.parse(map.get(key)) : null;
    },
    async setJSON(key, value) {
      map.set(key, JSON.stringify(value));
    },
  };
}

function req(method, body, host = "logan7in.art", ip = "1.2.3.4") {
  return new Request("https://" + host + "/api/coins", {
    method,
    headers: { "content-type": "application/json", "x-nf-client-connection-ip": ip },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

test("coin math is deterministic and explainable for every gallery kind", () => {
  assert.equal(M.ticker("p:1"), "P0001");
  assert.equal(M.ticker("p:1234"), "P1234");
  assert.equal(M.ticker("g:5919"), "G5919");
  assert.equal(M.ticker("s:12"), "S0012");
  assert.equal(M.ticker("si:12"), "I0012");
  assert.equal(M.ticker("v:7"), "V0007");
  const u = M.keyFor("u", "ph-mugjgl8q-6si7jj");
  assert.match(u, /^u:[0-9a-z]{4,8}$/);
  assert.equal(M.keyFor("u", "ph-mugjgl8q-6si7jj"), u); // stable
  assert.match(M.ticker(u), /^U-[0-9A-Z]{4,8}$/);
  for (const bad of ["p:0", "p:01", "q:1", "u:zz", "p:1234567", "", null, "p:1;x"]) {
    assert.equal(M.validKey(bad), false, String(bad));
  }
  assert.equal(M.rarity("p:1").tier, "Legendary");
  assert.equal(M.rarity("p:1000").tier, "Legendary");
  assert.equal(M.rarity("p:300").tier, "Epic");
  assert.equal(M.rarity("p:250").tier, "Rare");
  assert.equal(M.rarity("p:777").tier, "Rare");
  assert.equal(M.rarity("p:40").tier, "Uncommon");
  assert.equal(M.rarity("p:121").tier, "Uncommon");
  assert.equal(M.rarity("p:537").tier, "Common");
  assert.equal(M.baseValue("p:1"), 150); // (20 + 30) × 3
  assert.equal(M.baseValue("p:537"), 35); // 20 + 15
  assert.equal(M.baseValue("g:1"), 60); // (8 + 12) × 3
  assert.equal(M.baseValue("g:5919"), 9); // 8 + 1
  assert.equal(M.baseValue("s:12"), 16); // 6 + 10
  assert.equal(M.baseValue("v:492"), 16); // 15 + 1
  assert.ok(M.baseValue("p:1001") > 0); // new items are covered
  assert.equal(M.priceOf("p:537", {}), 35);
  assert.equal(M.priceOf("p:537", { v: 1 }), 39); // 35 × 1.1
  assert.equal(M.priceOf("p:537", { v: 1000000 }), 53); // popularity caps at +50%
  assert.equal(M.priceOf("p:537", { n: 10 }), 42); // 35 × 1.2
  assert.equal(M.priceOf("p:537", { n: 5000 }), 105); // demand caps at ×3
  assert.equal(M.priceOf("p:537", { n: -999 }), 18); // floor ×0.5
});

test("buy then sell never creates credits (3% fee)", () => {
  for (const k of ["p:1", "p:42", "p:500", "p:999", "g:3", "g:5919", "s:1", "si:777", "v:10", M.keyFor("u", "x")]) {
    for (const v of [0, 3, 50]) {
      for (const net of [-25, 0, 7, 99]) {
        for (const q of [1, 5, 50]) {
          const st = { v, n: net };
          const buy = M.quote(k, st, "buy", q);
          const after = M.applyTrade(k, st, "buy", q, 1).stats;
          const sell = M.quote(k, after, "sell", q);
          assert.ok(sell.total <= buy.total, `k=${k} v=${v} net=${net} q=${q}`);
          assert.equal(sell.netAfter, net);
        }
      }
    }
  }
});

test("GET returns an empty shared market with rules", async () => {
  const store = memStore();
  const res = await handleCoins(req("GET"), store, 1000);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.shared, true);
  assert.equal(j.scope, "live");
  assert.deepEqual(j.coins, {});
  assert.match(j.rules.currency, /play credits/);
  assert.equal(res.headers.get("cache-control").includes("no-store"), true);
});

test("trade updates supply/demand and history; limit guards price moves", async () => {
  const store = memStore();
  let res = await handleCoins(req("POST", { action: "trade", coin: "p:537", side: "buy", qty: 3, limit: 200 }), store, 10000);
  let j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.total, 35 + 36 + 36); // 35×1, 35×1.02=35.7→36, 35×1.04=36.4→36
  assert.equal(j.stats.b, 3);
  assert.equal(j.stats.n, 3);
  assert.equal(j.stats.h.length, 1);
  assert.equal(j.price, M.priceOf("p:537", { n: 3 }));
  assert.equal(j.coin, "p:537");

  // Stale limit → 409 with new quote, market unchanged.
  res = await handleCoins(req("POST", { action: "trade", coin: "p:537", side: "buy", qty: 1, limit: 35 }, "logan7in.art", "5.5.5.5"), store, 20000);
  j = await res.json();
  assert.equal(res.status, 409);
  assert.equal(j.priceMoved, true);
  assert.equal(j.quote.total, M.priceOf("p:537", { n: 3 }));

  // Rate limit per IP.
  res = await handleCoins(req("POST", { action: "trade", coin: "p:537", side: "sell", qty: 1 }, "logan7in.art", "5.5.5.5"), store, 20100);
  assert.equal(res.status, 429);

  res = await handleCoins(req("POST", { action: "trade", number: 537, side: "sell", qty: 1, limit: 1 }, "logan7in.art", "5.5.5.5"), store, 30000);
  j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.stats.s, 1);
  assert.equal(j.stats.n, 2);

  const g = await (await handleCoins(req("GET"), store, 40000)).json();
  assert.equal(g.coins["p:537"].n, 2);
  assert.equal(g.coins["p:537"].h.length, 2);
  assert.ok(store.map.has("market-v1/p"));
});

test("invalid trades are rejected", async () => {
  const store = memStore();
  const bad = [
    { action: "trade", coin: "p:0", side: "buy", qty: 1 },
    { action: "trade", coin: "zz:5", side: "buy", qty: 1 },
    { action: "trade", coin: "u:!", side: "buy", qty: 1 },
    { action: "trade", coin: "p:5", side: "steal", qty: 1 },
    { action: "trade", coin: "p:5", side: "buy", qty: 0 },
    { action: "trade", coin: "p:5", side: "buy", qty: 51 },
    { action: "cashout", number: 5 },
  ];
  let t = 0;
  for (const b of bad) {
    t += 10000;
    const res = await handleCoins(req("POST", b, "logan7in.art", "9.9.9." + t), store, t);
    assert.equal(res.status, 400, JSON.stringify(b));
  }
  const res = await handleCoins(req("POST", null), store, 1);
  assert.equal(res.status, 400);
});

test("views raise popularity; previews use a separate key space", async () => {
  const store = memStore();
  let res = await handleCoins(req("POST", { action: "view", coins: ["p:12", "p:12", "g:13", "si:4", "u:abcd", "x", "p:0"] }, "deploy-preview-40--1000paintings.netlify.app"), store, 5000);
  let j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.counted, 4);
  assert.equal(j.coins["p:12"].v, 1);
  assert.equal(j.coins["g:13"].v, 1);
  // throttled second batch from same IP
  res = await handleCoins(req("POST", { action: "view", coins: ["p:12"] }, "deploy-preview-40--1000paintings.netlify.app"), store, 5100);
  j = await res.json();
  assert.equal(j.throttled, true);
  const live = await (await handleCoins(req("GET"), store, 6000)).json();
  assert.deepEqual(live.coins, {});
  const prev = await (await handleCoins(req("GET", null, "deploy-preview-40--1000paintings.netlify.app"), store, 6000)).json();
  assert.equal(prev.scope, "preview");
  assert.equal(prev.coins["p:12"].v, 1);
  assert.equal(prev.coins["si:4"].v, 1);
  assert.equal(prev.coins["u:abcd"].v, 1);
  assert.ok(store.map.has("preview/market-v1/p"));
  assert.ok(store.map.has("preview/market-v1/g"));
  assert.ok(![...store.map.keys()].some((k) => k.startsWith("market-v1")));
  assert.equal(scopeFor(req("GET", null, "localhost")), "dev");
  assert.equal(scopeFor(req("GET", null, "logan7in.art")), "live");
});
