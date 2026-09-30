/**
 * Gallery Coins — shared market for the play-credit coins (one coin per gallery item:
 * paintings, generated, sketches, inverted sketches, videos, phone uploads, …).
 * Coin keys look like "p:12" (Painting #12) or "u:ab8thd" (hashed phone-upload id); see
 * js/painting-coins-math.js.
 *
 * GET  /api/coins                          → { ok, scope, rules, coins: { "<key>": {v,b,s,n,h} } }
 * POST /api/coins { action: "trade", coin, side: "buy"|"sell", qty, limit }
 *        limit = max total for a buy / min total for a sell (price-moved guard)
 * POST /api/coins { action: "view", coins: [key, ...] }   (gallery opens → popularity)
 *
 * PLAY CREDITS ONLY: the server never sees money. Visitor wallets and credit balances live in
 * the visitor's browser (localStorage, shared with Slots); this function only keeps the public
 * supply/demand counters and price history so every visitor sees the same prices.
 * Deploy previews / branch deploys use a separate "preview/" key space so they never touch the
 * live market.
 */
import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";
import CoinMath from "../../js/painting-coins-math.js";

const M = CoinMath && CoinMath.quote ? CoinMath : CoinMath.default;
const MARKET_PREFIX = "market-v1/"; // one blob per coin kind: market-v1/p, market-v1/g, …
const MAX_COINS_PER_KIND = 20000;
const RATE_PREFIX = "rl/";
const TRADE_COOLDOWN_MS = 600;
const VIEW_COOLDOWN_MS = 1500;
const MAX_VIEW_BATCH = 24;
const MAX_BODY = 4000;

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}

export function scopeFor(request) {
  let host = "";
  try {
    host = new URL(request.url).hostname.toLowerCase();
  } catch (e) {}
  if (!host || host === "localhost" || host === "127.0.0.1") return "dev";
  // deploy-preview-12--site.netlify.app / branch--site.netlify.app
  if (/--/.test(host)) return "preview";
  return "live";
}

function prefixFor(scope) {
  return scope === "live" ? "" : scope + "/";
}

function clientIp(request) {
  const h = request.headers;
  const raw =
    h.get("x-nf-client-connection-ip") || h.get("x-forwarded-for") || h.get("client-ip") || "";
  return String(raw).split(",")[0].trim() || "unknown";
}

function rateKey(prefix, ip, kind) {
  return (
    prefix + RATE_PREFIX + kind + "/" + String(ip || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)
  );
}

async function loadShard(store, prefix, kind) {
  try {
    const raw = await store.get(prefix + MARKET_PREFIX + kind, { type: "json" });
    if (raw && typeof raw === "object" && raw.coins && typeof raw.coins === "object") {
      const coins = {};
      for (const [k, v] of Object.entries(raw.coins)) {
        const pk = M.parseKey(k);
        if (pk && pk.kind === kind) coins[k] = M.cleanStats(v);
      }
      return { coins, updated: parseInt(raw.updated, 10) || 0 };
    }
  } catch (e) {}
  return { coins: {}, updated: 0 };
}

async function saveShard(store, prefix, kind, shard) {
  shard.updated = Date.now();
  await store.setJSON(prefix + MARKET_PREFIX + kind, shard);
}

async function loadAll(store, prefix) {
  const shards = await Promise.all(M.KIND_ORDER.map((kind) => loadShard(store, prefix, kind)));
  const coins = {};
  shards.forEach((sh) => Object.assign(coins, sh.coins));
  return coins;
}

function normKey(x) {
  if (typeof x === "number" || /^\d+$/.test(String(x || ""))) return "p:" + parseInt(x, 10);
  return String(x || "").trim().toLowerCase();
}

async function rateLimited(store, prefix, ip, kind, cooldown, now) {
  const key = rateKey(prefix, ip, kind);
  try {
    const last = await store.get(key, { type: "json" });
    if (last && now - (parseInt(last.t, 10) || 0) < cooldown) return true;
  } catch (e) {}
  try {
    await store.setJSON(key, { t: now });
  } catch (e) {}
  return false;
}

function publicRules() {
  const R = M.RULES;
  return {
    popStep: R.popStep,
    popMax: R.popMax,
    demandStep: R.demandStep,
    demandMin: R.demandMin,
    demandMax: R.demandMax,
    supply: R.supply,
    sellFee: R.sellFee,
    maxQty: R.maxQty,
    kinds: M.KIND_ORDER.map((k) => ({ kind: k, label: M.KINDS[k].plural, prefix: M.KINDS[k].prefix })),
    currency: "play credits (no cash value)",
  };
}

/** Core handler with an injectable store (used by tests and by the default export). */
export async function handleCoins(request, store, now = Date.now()) {
  if (request.method === "OPTIONS") return corsPreflight();
  const scope = scopeFor(request);
  const prefix = prefixFor(scope);

  if (request.method === "GET") {
    const coins = await loadAll(store, prefix);
    return noStore({ ok: true, shared: true, scope, now, rules: publicRules(), coins });
  }
  if (request.method !== "POST") {
    return noStore({ ok: false, error: "Method not allowed" }, 405);
  }

  let body = {};
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return noStore({ ok: false, error: "Body too large" }, 413);
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    return noStore({ ok: false, error: "Invalid JSON" }, 400);
  }
  const action = String((body && body.action) || "");
  const ip = clientIp(request);

  if (action === "view") {
    const list = Array.isArray(body.coins) ? body.coins : Array.isArray(body.numbers) ? body.numbers : [body.coin];
    const keys = [];
    for (const x of list.slice(0, MAX_VIEW_BATCH)) {
      const k = normKey(x);
      if (M.validKey(k) && keys.indexOf(k) < 0) keys.push(k);
    }
    if (!keys.length) return noStore({ ok: false, error: "No valid gallery coins" }, 400);
    if (await rateLimited(store, prefix, ip, "view", VIEW_COOLDOWN_MS, now)) {
      return noStore({ ok: true, counted: 0, throttled: true });
    }
    const byKind = {};
    keys.forEach((k) => {
      const kind = M.parseKey(k).kind;
      (byKind[kind] = byKind[kind] || []).push(k);
    });
    const changed = {};
    let counted = 0;
    for (const kind of Object.keys(byKind)) {
      const shard = await loadShard(store, prefix, kind);
      let size = Object.keys(shard.coins).length;
      for (const k of byKind[kind]) {
        if (!shard.coins[k]) {
          if (size >= MAX_COINS_PER_KIND) continue;
          size += 1;
        }
        shard.coins[k] = M.applyView(k, shard.coins[k], now);
        changed[k] = shard.coins[k];
        counted += 1;
      }
      await saveShard(store, prefix, kind, shard);
    }
    return noStore({ ok: true, counted, coins: changed });
  }

  if (action === "trade") {
    const key = normKey(body.coin != null ? body.coin : body.number);
    const side = String(body.side || "");
    const qty = parseInt(body.qty, 10);
    const pk = M.parseKey(key);
    if (!pk) return noStore({ ok: false, error: "Unknown gallery coin" }, 400);
    if (await rateLimited(store, prefix, ip, "trade", TRADE_COOLDOWN_MS, now)) {
      return noStore({ ok: false, error: "Slow down — one trade at a time.", retry: true }, 429);
    }
    const shard = await loadShard(store, prefix, pk.kind);
    const current = shard.coins[key];
    if (!current && Object.keys(shard.coins).length >= MAX_COINS_PER_KIND) {
      return noStore({ ok: false, error: "Market is full for this kind" }, 503);
    }
    const q = M.quote(key, current, side, qty);
    if (!q.ok) return noStore({ ok: false, error: q.error }, 400);
    const limit = body.limit == null ? null : Number(body.limit);
    if (limit != null && isFinite(limit)) {
      if ((side === "buy" && q.total > limit) || (side === "sell" && q.total < limit)) {
        return noStore(
          {
            ok: false,
            error: "Price moved — review the new quote.",
            priceMoved: true,
            quote: q,
            stats: M.cleanStats(current),
          },
          409
        );
      }
    }
    const res = M.applyTrade(key, current, side, qty, now);
    if (!res.ok) return noStore({ ok: false, error: res.error }, 400);
    shard.coins[key] = res.stats;
    await saveShard(store, prefix, pk.kind, shard);
    return noStore({
      ok: true,
      coin: key,
      side,
      qty: res.quote.qty,
      total: res.quote.total,
      price: res.quote.priceAfter,
      stats: res.stats,
    });
  }

  return noStore({ ok: false, error: "Unknown action" }, 400);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const store = getStore({ name: "painting-coins", consistency: "strong" });
  try {
    return await handleCoins(request, store);
  } catch (e) {
    return noStore({ ok: false, error: "Coin market unavailable" }, 500);
  }
}
