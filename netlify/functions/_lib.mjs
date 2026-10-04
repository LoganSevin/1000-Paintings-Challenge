import fs from "fs";
import path from "path";
import { AsyncLocalStorage } from "node:async_hooks";
import { getStore } from "@netlify/blobs";

const xaiKeyStore = new AsyncLocalStorage();

export function visitorXaiKey(request) {
  if (!request || !request.headers) return "";
  const raw =
    request.headers.get("x-visitor-xai-key") ||
    request.headers.get("X-Visitor-Xai-Key") ||
    "";
  return String(raw).replace(/^Bearer\s+/i, "").trim();
}

export function runWithXaiKey(key, fn) {
  return xaiKeyStore.run(String(key || "").trim(), fn);
}

export const API_IMAGES = "https://api.x.ai/v1/images/generations";
export const API_IMAGE_EDITS = "https://api.x.ai/v1/images/edits";
export const API_RESPONSES = "https://api.x.ai/v1/responses";
export const TEXT_MODEL = "grok-4.20-0309-non-reasoning";
export const IMAGE_MODEL = "grok-imagine-image-quality";

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, X-Visitor-Xai-Key, X-Visitor-Anthropic-Key, X-Visitor-OpenAI-Key",
    },
  });
}

export function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, X-Visitor-Xai-Key, X-Visitor-Anthropic-Key, X-Visitor-OpenAI-Key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

export const WOMBO_API = "https://api.luan.tools/api/tasks/";
export const WOMBO_STYLE_DEFAULT = 1;

export function isCreditsLimitError(err) {
  const m = String(err && err.message ? err.message : err || "").toLowerCase();
  return (
    m.includes("credit") ||
    m.includes("spending limit") ||
    m.includes("monthly spending") ||
    m.includes("purchase more")
  );
}

/** A negative gate stays on. -4 * -1 is the positive enabled value. */
export function positiveEnabledNumber(value, fallback) {
  let n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) n = n * -1;
  return n;
}

export function listXaiKeys(extra) {
  const keys = [];
  const seen = new Set();
  function add(raw) {
    const key = String(raw || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  }
  add(extra);
  add(xaiKeyStore.getStore());
  String(process.env.XAI_API_KEY || "")
    .split(/[\n\r,;]+/)
    .forEach(add);
  String(process.env.XAI_API_KEYS || "")
    .split(/[\n\r,;]+/)
    .forEach(add);
  return keys;
}

export function getXaiKey() {
  return listXaiKeys()[0] || "";
}

export function getWomboKey() {
  return (process.env.WOMBO_DREAM_API_KEY || process.env.DREAM_API_KEY || "").trim();
}

/**
 * Free Cloudflare Workers AI image fallback (used when xAI fails or has no key).
 * Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (Workers AI Read + Edit).
 * CF_IMAGE_MODEL is optional (default flux-1-schnell; SDXL also supported).
 */
export const CF_DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
export const CF_PROMPT_MAX = 2000;

export function getCfCreds() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
  return accountId && token ? { accountId, token } : null;
}

/**
 * Pollinations (gen.pollinations.ai) — third fallback behind Cloudflare. Its current API needs a
 * secret `sk_` key for server use (POLLINATIONS_API_KEY); without one this provider is off.
 */
export const POLLINATIONS_IMAGE_URL = "https://gen.pollinations.ai/image/";
export const POLLINATIONS_DEFAULT_MODEL = "flux";
export const POLLINATIONS_TIMEOUT_MS = 60000;
/** Abort after this long (POLLINATIONS_TIMEOUT_MS env, 1–75 s); the job function allows 120 s total. */
export function getPollinationsTimeoutMs() {
  const n = parseInt(String(process.env.POLLINATIONS_TIMEOUT_MS || ""), 10);
  return n >= 1000 && n <= 75000 ? n : POLLINATIONS_TIMEOUT_MS;
}
export function getPollinationsKey() {
  return String(process.env.POLLINATIONS_API_KEY || "").trim();
}
export function getPollinationsModel() {
  return String(process.env.POLLINATIONS_IMAGE_MODEL || "").trim() || POLLINATIONS_DEFAULT_MODEL;
}

/** Ordered image fallback chain after the primary provider, for /api/health. */
export function getImageFallbackChain() {
  const chain = [];
  if (getCfCreds()) chain.push("cloudflare");
  if (getPollinationsKey()) chain.push("pollinations");
  if (getWomboKey()) chain.push("wombo");
  return chain;
}

/** flux-1-schnell diffusion steps (Cloudflare max 8). CF_IMAGE_STEPS overrides. */
export const CF_FLUX_STEPS_DEFAULT = 4;
export function getCfFluxSteps() {
  const n = positiveEnabledNumber(parseInt(String(process.env.CF_IMAGE_STEPS || ""), 10), CF_FLUX_STEPS_DEFAULT);
  return n >= 1 && n <= 8 ? n : CF_FLUX_STEPS_DEFAULT;
}

export function getCfImageModel() {
  return String(process.env.CF_IMAGE_MODEL || "").trim() || CF_DEFAULT_IMAGE_MODEL;
}

export function getImageProvider() {
  const forced = (process.env.SPELLFORGE_IMAGE_PROVIDER || "").trim().toLowerCase();
  const hasXai = !!getXaiKey();
  const hasWombo = !!getWomboKey();
  const hasCf = !!getCfCreds();
  const hasPoll = !!getPollinationsKey();
  if (forced === "pollinations" && hasPoll) return "pollinations";
  if (forced === "cloudflare" && hasCf) return "cloudflare";
  if (forced === "wombo") return hasWombo ? "wombo" : hasXai ? "xai" : hasCf ? "cloudflare" : "wombo";
  if (forced === "xai") return hasXai ? "xai" : hasCf ? "cloudflare" : hasWombo ? "wombo" : "xai";
  if (!hasXai && hasCf) return "cloudflare";
  if (hasWombo && !hasXai) return "wombo";
  if (!hasXai && hasPoll) return "pollinations";
  return "xai";
}

export function isImageApiConfigured() {
  const provider = getImageProvider();
  if (provider === "cloudflare" || provider === "pollinations") return true;
  return provider === "wombo" ? !!getWomboKey() : !!getXaiKey();
}

export function getApiKey() {
  const key = listXaiKeys()[0];
  if (!key) {
    throw new Error(
      "No xAI API key. Connect a key from console.x.ai, or add XAI_API_KEY on Netlify."
    );
  }
  return key;
}

/** xAI rejected the key itself (wrong/revoked/placeholder), as opposed to a billing limit. */
export function isInvalidKeyError(err) {
  const m = String(err && err.message ? err.message : err || "").toLowerCase();
  return (
    m.includes("incorrect api key") ||
    m.includes("invalid api key") ||
    m.includes("api key is invalid") ||
    m.includes("invalid authentication") ||
    m.includes("no api key provided") ||
    /\bunauthori[sz]ed\b/.test(m)
  );
}

export const VISITOR_KEY_REJECTED = "Your saved xAI key was rejected by xAI";

/**
 * Try keys in order (visitor key first, then XAI_API_KEY / XAI_API_KEYS).
 * Moves on to the next key when a key is out of credits OR rejected as invalid,
 * so a stale/wrong visitor key no longer blocks the site key. Any other error
 * stops immediately. If the visitor key was rejected and nothing else worked,
 * the error says so (prefix VISITOR_KEY_REJECTED) so the page can ask to reconnect.
 */
export async function withXaiKeyFallback(fn, extraKey) {
  const keys = listXaiKeys(extraKey);
  if (!keys.length) {
    throw new Error(
      "No xAI API key. Connect a key from console.x.ai to keep generating."
    );
  }
  const visitorKeys = new Set(
    [extraKey, xaiKeyStore.getStore()]
      .map((k) => String(k || "").trim())
      .filter(Boolean)
  );
  let lastErr;
  let visitorRejected = null;
  function finalError(err) {
    if (!visitorRejected) return err;
    const why = visitorRejected.message || String(visitorRejected);
    if (err === visitorRejected) {
      return new Error(
        `${VISITOR_KEY_REJECTED} (${why}). Reconnect a valid key from console.x.ai.`
      );
    }
    return new Error(
      `${VISITOR_KEY_REJECTED} (${why}). The site's backup key also failed: ${
        (err && err.message) || String(err)
      }`
    );
  }
  for (let i = 0; i < keys.length; i++) {
    try {
      return await runWithXaiKey(keys[i], function () {
        return fn(keys[i]);
      });
    } catch (err) {
      lastErr = err;
      const invalid = isInvalidKeyError(err);
      if (invalid && !visitorRejected && visitorKeys.has(keys[i])) visitorRejected = err;
      if (!invalid && !isCreditsLimitError(err)) throw finalError(err);
    }
  }
  throw finalError(lastErr);
}

const GROK_LOGIN_TOKEN_URL = "https://auth.x.ai/oauth2/token";
let grokLoginCache = { token: "", exp: 0 };

export function shouldTryGrokLogin(err) {
  const msg = String(err && err.message ? err.message : err || "");
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    isCreditsLimitError(err) ||
    isInvalidKeyError(err) ||
    /no xai api key/i.test(msg) ||
    m.includes("at capacity") ||
    m.includes("temporarily") ||
    m.includes("rate limit") ||
    m.includes("too many requests")
  );
}

function jwtExp(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return 0;
    const pad = part + "=".repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(pad, "base64url").toString("utf8"));
    return Number(payload.exp) || 0;
  } catch (e) {
    return 0;
  }
}

async function readGrokLoginSession() {
  try {
    const store = getStore({ name: "grok-login", consistency: "strong" });
    const saved = await store.get("session", { type: "json" });
    if (saved && typeof saved === "object") return saved;
  } catch (e) {}
  return null;
}

async function writeGrokLoginSession(session) {
  try {
    const store = getStore({ name: "grok-login", consistency: "strong" });
    await store.setJSON("session", session);
  } catch (e) {}
}

/** Access token for the Grok login. Used when the console API key is out of credits. */
export async function grokLoginAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (grokLoginCache.token && grokLoginCache.exp > now + 120) return grokLoginCache.token;

  const saved = await readGrokLoginSession();
  const clientId = String(
    (saved && saved.client_id) || process.env.XAI_OIDC_CLIENT_ID || ""
  ).trim();
  const refresh = String(
    (saved && saved.refresh_token) || process.env.XAI_OAUTH_REFRESH_TOKEN || ""
  ).trim();
  const cachedAccess = String((saved && saved.access_token) || "").trim();
  const cachedExp = Number(saved && saved.exp) || jwtExp(cachedAccess);
  if (cachedAccess && cachedExp > now + 120) {
    grokLoginCache = { token: cachedAccess, exp: cachedExp };
    return cachedAccess;
  }
  if (!refresh || !clientId) return "";

  const res = await fetch(GROK_LOGIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
    }).toString(),
  });
  if (!res.ok) return "";
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    return "";
  }
  const access = String(data.access_token || "").trim();
  if (!access) return "";
  const exp = now + (Number(data.expires_in) || 3600);
  grokLoginCache = { token: access, exp };
  await writeGrokLoginSession({
    access_token: access,
    refresh_token: String(data.refresh_token || refresh).trim(),
    exp,
    client_id: clientId,
  });
  return access;
}

export async function listVideoKeys(extra) {
  const keys = listXaiKeys(extra);
  const login = await grokLoginAccessToken();
  if (login && keys.indexOf(login) < 0) keys.push(login);
  return keys;
}

/**
 * Console keys first. When they are out of credits or rejected, use the Grok login.
 */
export async function withVideoAuth(fn, extraKey) {
  try {
    return await withXaiKeyFallback(fn, extraKey);
  } catch (err) {
    if (!shouldTryGrokLogin(err)) throw err;
    const token = await grokLoginAccessToken();
    if (!token) throw err;
    return fn(token);
  }
}

export function getImageApiKey() {
  if (getImageProvider() === "wombo") {
    const key = getWomboKey();
    if (!key) {
      throw new Error(
        "WOMBO_DREAM_API_KEY is not set. Get a key at https://api.dream.ai/signup — then add it on Netlify and redeploy."
      );
    }
    return key;
  }
  return getApiKey();
}

export function apiErrorMessage(data, status) {
  if (typeof data?.error === "string") return data.error;
  if (data?.error?.message) return data.error.message;
  if (data?.message) return data.message;
  return `HTTP ${status}`;
}

export function loadAnalyses() {
  const p = path.join(process.cwd(), "data", "analyses.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function extractResponseText(body) {
  for (const item of body.output || []) {
    if (item.type === "message") {
      for (const block of item.content || []) {
        if (block.type === "output_text" || block.type === "text") {
          return block.text || "";
        }
      }
    }
  }
  if (body.choices?.[0]?.message?.content) return body.choices[0].message.content;
  return "";
}

export function parseJsonBlob(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return JSON.parse(t);
}

/** xAI hard max on final prompt; stay a few under to avoid edge rejects. */
export const GEN_PROMPT_MAX_CHARS = 8000;
export const GEN_PROMPT_SAFE_MAX = 7992;
export const GEN_STASIS_BODY_MAX = 7200;

function pad2(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  return n < 10 ? "0" + n : String(n);
}

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** In-canvas signature: "Logan Sevin · 27 September 2026  20:31:00 PDT" */
export function authorshipSignature(clientStamp) {
  const artist = "Logan Sevin";
  let stamp = String(clientStamp || "").trim();
  if (!stamp) {
    const d = new Date();
    stamp =
      d.getUTCDate() +
      " " +
      MONTHS_LONG[d.getUTCMonth()] +
      " " +
      d.getUTCFullYear() +
      "  " +
      pad2(d.getUTCHours()) +
      ":" +
      pad2(d.getUTCMinutes()) +
      ":" +
      pad2(d.getUTCSeconds()) +
      " UTC";
  }
  return artist + " · " + stamp;
}

export function authorshipFooter(aspectRatio, clientStamp) {
  const frame = aspectPhrase(aspectRatio);
  const sig = authorshipSignature(clientStamp);
  return (
    `\n\nCompose for a ${frame} frame and fill the entire canvas. Do not letterbox.\n` +
    `IN-CANVAS SIGNATURE (mandatory, small, painterly, lower corner like a real painting): write exactly "${sig}". ` +
    "Do not invent a fake date. Do not omit the clock time."
  );
}

export function clipPromptChars(text, max = GEN_PROMPT_SAFE_MAX) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  let cut = t.slice(0, Math.max(0, max - 1));
  const nl = cut.lastIndexOf("\n");
  if (nl > max * 0.55) cut = cut.slice(0, nl);
  else {
    const sp = cut.lastIndexOf(" ");
    if (sp > max * 0.7) cut = cut.slice(0, sp);
  }
  return cut.replace(/\s+$/g, "") + "…";
}

/** Index where the client locked the frame and/or the painted signature. */
function protectedTailAt(text) {
  const t = String(text || "");
  let at = -1;
  for (const mark of ["OUTPUT ASPECT", "IN-CANVAS SIGNATURE", "Compose for a "]) {
    const i = t.lastIndexOf(mark);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at <= 0) return -1;
  const nl = t.lastIndexOf("\n", at);
  return nl >= 0 ? nl : at;
}

/**
 * Stay under the API cap without eating the signature, the aspect line, or a
 * later spell. Extra length comes out of the longest SPELL body.
 */
export function fitPromptKeepingTail(text, max = GEN_PROMPT_SAFE_MAX) {
  let t = String(text || "").trim();
  if (!t || t.length <= max) return t;
  const at = protectedTailAt(t);
  const tail = at > 0 ? t.slice(at).trim() : "";
  let head = at > 0 ? t.slice(0, at).trim() : t;
  const budget = tail ? max - tail.length - 2 : max;
  if (budget < 200) return clipPromptChars(t, max);
  const parts = head.split(/(?=^SPELL (?:[1-9]|[IVX]+)\b)/m);
  let guard = 0;
  while (head.length > budget && guard < 24) {
    guard += 1;
    let longest = -1;
    let longestLen = 0;
    for (let i = 0; i < parts.length; i++) {
      if (!/^SPELL (?:[1-9]|[IVX]+)\b/m.test(parts[i])) continue;
      if (parts[i].length > longestLen) {
        longestLen = parts[i].length;
        longest = i;
      }
    }
    if (longest < 0) break;
    const lines = parts[longest].split("\n");
    const header = lines[0];
    const body = lines.slice(1).join("\n").trim();
    const overflow = head.length - budget;
    const nextLen = Math.max(40, body.length - overflow - 1);
    parts[longest] = header + "\n" + clipPromptChars(body, nextLen);
    head = parts.join("").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (head.length > budget) head = clipPromptChars(head, budget);
  return tail ? head + "\n\n" + tail : head;
}

const SPELL_HEADER_RE = /^SPELL (?:[1-9]|[IVX]+)\b/;
const SPELLFORGE_OUTCOME_LINE_RE =
  /^(?:FINAL OUTCOME\b|FUSION(?: DIRECTIVE)?:|Output:|OUTPUT ASPECT\b|IN-CANVAS SIGNATURE\b|Compose for a |Style DNA\b|Mood DNA\b|Motif tags\b|Buzz words:|Artist synthesis\b|Extra direction:|MANDATORY\b|THREE IDENTITIES\b|THE THREE IDENTITIES\b|Spellforge three-spell fusion\b|Create one original\b)/;
const SPELLFORGE_FUSION =
  "Spellforge three-spell fusion: this is one combination painting. Mix the forms, colors, and subjects of Spell 1, Spell 2, and Spell 3 into a single new scene. Each spell stays visible inside the mix. Do not paint Spell 1 by itself.";

/** Drop a source painting's own image prompt so it cannot replace the combination. */
function stripSingleSpellPrompts(block) {
  return String(block || "")
    .split(/\n\s*\n/)
    .filter((para, i) => i === 0 || !/^(generation prompt|source \(verbatim\))\s*:/i.test(para.trim()))
    .join("\n\n")
    .trim();
}

/** Word-boundary clip with no ellipsis, so shares can share one sentence. */
function clipShareEven(share, cap) {
  let s = String(share || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= cap) return s.replace(/[.…]+$/, "").trim();
  let cut = s.slice(0, cap);
  const sp = cut.lastIndexOf(" ");
  if (sp > cap * 0.55) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:—–-]+$/, "").replace(/[.…]+$/, "").trim();
}

function equalShareLimit(shares) {
  const shortest = Math.min(...shares.map((s) => String(s || "").length));
  return Math.max(140, Math.min(420, shortest || 140));
}

/** Descriptive text of one spell block, without its header, title repeat, or style lines. */
function spellShareText(block) {
  const lines = String(block || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const header = lines[0] || "";
  const title = header
    .replace(/^SPELL\s+(?:[1-9]|[IVX]+)\s*[—–-]\s*/i, "")
    .replace(/\s*\(#\d+\)\s*$/, "")
    .trim();
  const kept = [];
  for (const line of lines.slice(1)) {
    if (/^(style|tags|mood|generation prompt|source)\s*:/i.test(line)) continue;
    if (/^(generated still|phone upload|line sketch|inverted sketch)\b/i.test(line)) continue;
    if (/^\(description pending/i.test(line)) continue;
    if (/^\(no description\)$/i.test(line)) continue;
    if (title && line.toLowerCase() === title.toLowerCase()) continue;
    kept.push(line);
  }
  let share = kept.join(" ").replace(/\s+/g, " ").trim();
  if (!share) share = title || "its own forms and colors";
  return share.replace(/[.…]+$/, "").trim();
}

/**
 * One paragraph. Each spell gets the same cap, so a long Spell 1 cannot lead.
 * The first share keeps its capital. Later shares are lowercased.
 */
function conjoinedFromShares(shares) {
  const clean = (shares || []).map((s) => String(s || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!clean.length) return "";
  const cap = equalShareLimit(clean);
  const bits = clean
    .map((share, i) => {
      const bit = clipShareEven(share, cap);
      if (!bit) return "";
      return i === 0 ? bit : bit.charAt(0).toLowerCase() + bit.slice(1);
    })
    .filter(Boolean);
  return (
    "COMBINATION PIECE: paint one combination from this conjoined detail. Do not paint Spell 1 by itself.\n" +
    "Conjoined detail for one combination painting: " +
    bits.join(", together with ") +
    "."
  );
}

/** Drop an older combination lead so it is not painted in front of the paragraph. */
function stripOldCombination(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((para) => {
      if (!para) return false;
      if (/^COMBINATION PIECE\b/i.test(para)) return false;
      if (/^Conjoined detail\b/i.test(para)) return false;
      if (/Spell\s+\d+\s+contributes\b/i.test(para)) return false;
      return true;
    })
    .join("\n\n")
    .trim();
}

/** Pull the conjoined paragraph down to `budget` by shortening every share together. */
function shrinkConjoinedBlock(text, budget) {
  let next = String(text || "").trim();
  if (next.length <= budget) return next;
  const start = next.search(/Conjoined detail for one combination painting:/i);
  if (start < 0) return clipPromptChars(next, budget);
  const after = next.slice(start);
  const endRel = after.search(/\n\s*\n/);
  let end = endRel < 0 ? next.length : start + endRel;
  const block = next.slice(start, end);
  const body = block
    .replace(/^Conjoined detail for one combination painting:\s*/i, "")
    .replace(/\.\s*$/, "");
  const shares = body.split(/,\s*together with\s+/i);
  let cap = Math.max(...shares.map((s) => s.length), 48);
  let guard = 0;
  while (next.length > budget && cap > 48 && guard < 16) {
    guard += 1;
    const overflow = next.length - budget;
    cap = Math.max(48, cap - Math.ceil(overflow / Math.max(1, shares.length)) - 4);
    const bits = shares
      .map((share, i) => {
        const bit = clipShareEven(share, cap);
        if (!bit) return "";
        return i === 0 ? bit : bit.charAt(0).toLowerCase() + bit.slice(1);
      })
      .filter(Boolean);
    const para = "Conjoined detail for one combination painting: " + bits.join(", together with ") + ".";
    next = next.slice(0, start) + para + next.slice(end);
    end = start + para.length;
  }
  if (next.length > budget) return clipPromptChars(next, budget);
  return next;
}

function preludeWithoutIdentityBanner(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !/^THREE IDENTITIES IN ONE PAINTING\.?$/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pull Spell I–III blocks out, leaving the aspect line and the outcome copy separate. */
function splitSpellforgeReferences(raw) {
  const lines = String(raw || "").split("\n");
  const spells = [];
  const prelude = [];
  const outcome = [];
  let current = null;
  let seenSpell = false;
  let inOutcome = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inOutcome && SPELL_HEADER_RE.test(trimmed)) {
      if (current) spells.push(current.join("\n").trim());
      current = [line];
      seenSpell = true;
      continue;
    }
    const outcomeStart = SPELLFORGE_OUTCOME_LINE_RE.test(trimmed);
    // The identity banner sits in front of the spell blocks. It is not the outcome.
    if (/^THREE IDENTITIES IN ONE PAINTING\.?$/i.test(trimmed) && !current && !seenSpell) {
      prelude.push(line);
      continue;
    }
    if (outcomeStart && (current || !seenSpell)) {
      if (current) {
        spells.push(current.join("\n").trim());
        current = null;
      }
      inOutcome = true;
      seenSpell = true;
      outcome.push(line);
      continue;
    }
    if (current) current.push(line);
    else if (inOutcome || seenSpell) outcome.push(line);
    else prelude.push(line);
  }
  if (current) spells.push(current.join("\n").trim());
  const clean = (arr) => arr.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    prelude: clean(prelude),
    spells: spells.filter(Boolean),
    outcome: clean(outcome),
  };
}

function peelAspectLines(prelude) {
  const aspect = [];
  const other = [];
  for (const line of String(prelude || "").split("\n")) {
    if (/canvas —/.test(line)) aspect.push(line);
    else other.push(line);
  }
  return {
    aspect: aspect.join("\n").trim(),
    other: other.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/**
 * One conjoined paragraph of equal detail, then the fusion / outcome instruction.
 * Stacked SPELL essays are replaced, not kept behind the paragraph.
 * The aspect line stays first. The painted signature stays last.
 */
export function orderSpellforgePrompt(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const at = protectedTailAt(text);
  const tail = at > 0 ? text.slice(at).trim() : "";
  const head = at > 0 ? text.slice(0, at).trim() : text;
  const split = splitSpellforgeReferences(head);
  const spells = split.spells.map(stripSingleSpellPrompts).filter(Boolean);
  const peeled = peelAspectLines(split.prelude);
  const other = preludeWithoutIdentityBanner(peeled.other);
  const hasConjoined = /COMBINATION PIECE|Conjoined detail/i.test(other);
  if (!spells.length && !hasConjoined) return text;

  let detail;
  if (spells.length) {
    const rebuilt = conjoinedFromShares(spells.map(spellShareText));
    const rest = stripOldCombination(other);
    detail = [rebuilt, rest].filter(Boolean).join("\n\n");
  } else {
    detail = other;
  }

  let outcomeBody = split.outcome;
  if (!/Spellforge three-spell fusion/i.test(`${outcomeBody}\n${detail}`)) {
    outcomeBody = [SPELLFORGE_FUSION, outcomeBody].filter(Boolean).join("\n\n");
  }
  const parts = [peeled.aspect, detail, outcomeBody].filter(Boolean);
  let ordered = parts.join("\n\n");
  if (tail) ordered += "\n\n" + tail;
  return ordered;
}

/** Keep the conjoined paragraph and the signature. Shorten every share together when over the cap. */
export function fitSpellforgePrompt(text, max = GEN_PROMPT_SAFE_MAX) {
  const ordered = orderSpellforgePrompt(text);
  if (!ordered || ordered.length <= max) return ordered;
  const at = protectedTailAt(ordered);
  const tail = at > 0 ? ordered.slice(at).trim() : "";
  let head = at > 0 ? ordered.slice(0, at).trim() : ordered;
  const budget = tail ? max - tail.length - 2 : max;
  if (budget < 200) return clipPromptChars(ordered, max);
  if (/Conjoined detail/i.test(head)) head = shrinkConjoinedBlock(head, budget);
  if (head.length > budget) head = clipPromptChars(head, budget);
  return tail ? head + "\n\n" + tail : head;
}

export const ALLOWED_ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];

export function normalizeAspect(value, fallback = "16:9") {
  const v = String(value || "")
    .trim()
    .replace("/", ":")
    .replace(/\s+/g, "");
  return ALLOWED_ASPECTS.includes(v) ? v : fallback;
}

export function aspectPhrase(aspect) {
  const a = normalizeAspect(aspect);
  const [w, h] = a.split(":").map(Number);
  // "landscape" / "portrait" make image models paint scenery or a posed sitter.
  const orient = w === h ? "square" : w > h ? "wide" : "tall";
  return `${a} ${orient}`;
}

export function aspectToSize(aspect, longSide = 1280) {
  const a = normalizeAspect(aspect);
  const [aw, ah] = a.split(":").map(Number);
  if (aw >= ah) {
    return { width: longSide, height: Math.max(1, Math.round((longSide * ah) / aw)) };
  }
  return { width: Math.max(1, Math.round((longSide * aw) / ah)), height: longSide };
}

export function buildAzLinePrompt(stasis) {
  const scene = String(stasis || "").trim();
  const lead = (scene.split(/[.!\n]/)[0] || scene).trim() || "a single form";
  return (
    lead +
    ". Black ink contour drawing of that exact subject on plain white paper. " +
    "High-contrast black lines only, no color, no wash, no hillside, no mountain unless those words are the subject. " +
    "The only subject is: " +
    lead +
    "."
  );
}

export function buildStasisVisionPrompt(stasis, buzzWords, aspectRatio, opts = {}) {
  if (opts.source === "az") return buildAzLinePrompt(stasis);
  const buzz =
    buzzWords?.length > 0
      ? buzzWords.slice(0, 16).join(", ")
      : "rich painterly detail";
  const frame = aspectPhrase(aspectRatio);
  const raw = String(stasis || "").trim();
  const aspectLine = `${frame} canvas — output this exact aspect ratio, not square unless the ratio is 1:1.`;
  const spellforge =
    /THREE IDENTITIES IN ONE PAINTING/i.test(raw) ||
    /^SPELL (?:[1-9]|[IVX]+)\s*—/m.test(raw) ||
    /COMBINATION PIECE/i.test(raw) ||
    /Conjoined detail/i.test(raw);
  // Spell I–III stay in front of the outcome sentence. The signature stays on the tail.
  if (spellforge) {
    const signed = /IN-CANVAS SIGNATURE/i.test(raw);
    const outcomeTail = signed
      ? ""
      : "FINAL OUTCOME:\n" +
        "Create one original fine-art painting that embodies this fused vision. " +
        "Invent fresh imagery — not a photograph or collage of references.\n\n" +
        `BUZZ WORDS (weave these into texture, motifs, palette accents, and micro-detail): ${buzz}\n\n` +
        "The image should read clearly at thumbnail scale yet reward close viewing. " +
        "Museum-quality, cohesive composition, expressive brushwork." +
        authorshipFooter(aspectRatio, opts.signature);
    const combined = outcomeTail ? raw + "\n\n" + outcomeTail : raw;
    return fitSpellforgePrompt(aspectLine + "\n\n" + combined, GEN_PROMPT_SAFE_MAX);
  }
  const lead = aspectLine + "\n";
  if (/IN-CANVAS SIGNATURE/i.test(raw)) {
    return fitPromptKeepingTail(lead + raw, GEN_PROMPT_SAFE_MAX);
  }
  const footer = authorshipFooter(aspectRatio, opts.signature);
  const prefix =
    lead +
    "Create one original fine-art painting that embodies this fused vision. " +
    "Invent fresh imagery — not a photograph or collage of references.\n\n" +
    "STASIS (locked fusion — the scene, mood, and narrative to paint):\n";
  const suffix =
    `\n\nBUZZ WORDS (weave these into texture, motifs, palette accents, and micro-detail): ${buzz}\n\n` +
    "The image should read clearly at thumbnail scale yet reward close viewing. " +
    "Museum-quality, cohesive composition, expressive brushwork." +
    footer;
  const overhead = prefix.length + suffix.length;
  const bodyMax = Math.min(
    GEN_STASIS_BODY_MAX,
    Math.max(400, GEN_PROMPT_SAFE_MAX - overhead)
  );
  const body = clipPromptChars(raw, bodyMax);
  return prefix + body + suffix;
}

export async function saveJob(store, jobId, data) {
  await store.setJSON(jobId, { ...data, updated_at: Date.now() });
}

export async function loadJob(store, jobId) {
  return store.get(jobId, { type: "json" });
}

function womboHeaders(token, json = true) {
  const h = {
    Origin: "https://dream.ai",
    Referer: "https://dream.ai/",
    Authorization: "bearer " + token,
    service: "Dream",
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export function truncateWomboPrompt(text, max = 100) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

export function buildWomboPrompt(stasis, buzzWords) {
  let base = (stasis || "").replace(/\s+/g, " ").trim();
  if (base.length > 72) base = base.slice(0, 72);
  const buzz = (buzzWords || []).slice(0, 6).join(", ");
  const prompt = buzz ? `${base}, ${buzz}` : base;
  return truncateWomboPrompt(prompt, 100);
}

function extractWomboImageUrl(task) {
  const r = task?.result || task;
  const gens = r?.final_generations || r?.generations || [];
  for (let i = 0; i < gens.length; i++) {
    const g = gens[i];
    if (g?.url) return g.url;
    if (g?.image_url) return g.image_url;
    if (g?.jpg) return g.jpg;
  }
  if (r?.image_url) return r.image_url;
  if (task?.image_url) return task.image_url;
  throw new Error("No image URL in WOMBO Dream response.");
}

export async function generateWomboStasisImage(stasis, buzzWords, aspectRatio) {
  const token = getWomboKey();
  if (!token) {
    throw new Error("WOMBO_DREAM_API_KEY is not set.");
  }
  const prompt = buildWomboPrompt(stasis, buzzWords);
  const styleId = parseInt(process.env.WOMBO_STYLE_ID || String(WOMBO_STYLE_DEFAULT), 10) || 1;
  const sized = aspectToSize(aspectRatio, 1280);
  const width = sized.width;
  const height = sized.height;

  const createResp = await fetch(WOMBO_API, {
    method: "POST",
    headers: womboHeaders(token),
    body: JSON.stringify({ use_target_image: false }),
  });
  const createData = await createResp.json();
  if (!createResp.ok) {
    throw new Error(apiErrorMessage(createData, createResp.status));
  }

  const taskId = createData.id;
  if (!taskId) throw new Error("WOMBO did not return a task id.");

  const putResp = await fetch(WOMBO_API + taskId, {
    method: "PUT",
    headers: womboHeaders(token),
    body: JSON.stringify({
      input_spec: {
        style: styleId,
        prompt,
        target_image_weight: 0.5,
        width,
        height,
      },
    }),
  });
  const putData = await putResp.json();
  if (!putResp.ok) {
    throw new Error(apiErrorMessage(putData, putResp.status));
  }

  let task = putData;
  let pollDelay = 750;
  for (let i = 0; i < 120; i++) {
    if (task.state === "completed") {
      return extractWomboImageUrl(task);
    }
    if (task.state === "failed") {
      throw new Error(task.error || task.message || "WOMBO Dream generation failed.");
    }
    await new Promise((r) => setTimeout(r, pollDelay));
    pollDelay = Math.min(2000, pollDelay + 150);
    const pollResp = await fetch(WOMBO_API + taskId, { headers: womboHeaders(token) });
    task = await pollResp.json();
    if (!pollResp.ok) {
      throw new Error(apiErrorMessage(task, pollResp.status));
    }
  }
  throw new Error("WOMBO Dream timed out (3 minutes).");
}

export async function materializeStillDataUrl(imageUrl) {
  const url = String(imageUrl || "").trim();
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  const resp = await fetch(url);
  if (!resp.ok) return url;
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 32) return url;
  let mime = String(resp.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim();
  if (!mime.startsWith("image/")) {
    if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
    else if (buf[0] === 0x89) mime = "image/png";
    else mime = "image/jpeg";
  }
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Words that trip image moderation. A strike drops these from the prompt. */
const MODERATION_WORD_RES = [
  /\b(batman|joker|superman|spiderman|spider-?man|iron\s*man|thanos|yoda|vader|darth|grogu|baby\s*yoda|mandalorian|elsa|olaf|mario|luigi|harry\s*potter|voldemort|hogwarts|gandalf|sauron|gollum|deadpool|wolverine|hulk|black\s*panther|wakanda|barbie|mickey|minnie|disney|marvel|dc\s*comics|lightsaber|death\s*star|millennium\s*falcon|avengers|infinity\s*gauntlet|jedi|sith|skywalker|chewbacca|pennywise|xenomorph|terminator|buzz\s*lightyear|spongebob|pikachu|pokemon|pokémon|inception|matrix|oppenheimer|dune|euphoria|wednesday|john\s*wick|top\s*gun|star\s*wars|star\s*trek|breaking\s*bad|stranger\s*things|squid\s*game|nazi|swastika|isis|porn|nude|naked|nsfw|explicit\s*sex|child\s*porn|underage|lolita)\b/gi,
  /\b(gore|beheading|dismember|bloody\s*massacre|torture|rape|suicidal|school\s*shooting)\b/gi,
  /\b(gun|rifle|pistol|blood|corpse|kill|murder|weapon|war\s*crime|lingerie|sexy|erotic)\b/gi,
  /\b(tt\d{7,8}|imdb\.com\/title)\b/gi,
];

export function dropModerationTriggerWords(text) {
  let out = String(text || "");
  const dropped = [];
  const seen = new Set();
  for (const re of MODERATION_WORD_RES) {
    out = out.replace(new RegExp(re.source, re.flags), (match) => {
      const key = match.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        dropped.push(match);
      }
      return " ";
    });
  }
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,(\s*,)+/g, ",")
    .replace(/^[ \t]*[,.;:]+[ \t]*/gm, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { prompt: out, dropped };
}

export function moderationStrikeFromImageResponse(data, prompt) {
  const items = Array.isArray(data?.data) ? data.data : [];
  const struck =
    data?.respect_moderation === false ||
    items.some((item) => item && item.respect_moderation === false);
  if (!struck) return null;
  const cleaned = dropModerationTriggerWords(prompt);
  return {
    moderated: true,
    prompt: cleaned.prompt,
    dropped: cleaned.dropped,
  };
}

function xaiImageFromResponse(data, prompt) {
  const strike = moderationStrikeFromImageResponse(data, prompt);
  if (strike) return strike;
  const items = data.data || [];
  if (!items.length) throw new Error("No image returned from xAI.");
  const item = items[0];
  if (item.b64_json) return `data:image/jpeg;base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error("No image data in xAI response.");
}

export function buildFlashProjectPrompt(stasis, buzzWords, aspectRatio, opts = {}) {
  const buzz =
    buzzWords?.length > 0
      ? buzzWords.slice(0, 16).join(", ")
      : "rich painterly detail";
  const footer = authorshipFooter(aspectRatio, opts.signature);
  const prefix =
    "Paint one NEW original fine-art still inspired by the attached overhead-projector composition. " +
    "This must be a finished museum painting, not a photograph of acetate, glass, or the source collage. " +
    "Keep the same subjects, spatial arrangement, and mood, but invent fresh brushwork and lighting.\n\n" +
    "STASIS (scene to paint):\n";
  const suffix =
    `\n\nBUZZ WORDS: ${buzz}\n\n` +
    "Museum-quality, cohesive composition, expressive brushwork." +
    footer;
  const overhead = prefix.length + suffix.length;
  const bodyMax = Math.min(
    GEN_STASIS_BODY_MAX,
    Math.max(400, GEN_PROMPT_SAFE_MAX - overhead)
  );
  const body = clipPromptChars(String(stasis || "").trim(), bodyMax);
  return prefix + body + suffix;
}

function moderationMessage(text) {
  return /content policy|usage policy|moderation|safety filter/i.test(String(text || ""));
}

async function postXaiImage(url, payload, apiKey) {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok) {
    const message = apiErrorMessage(data, resp.status);
    if (moderationMessage(message)) {
      const cleaned = dropModerationTriggerWords(payload && payload.prompt);
      return {
        moderated: true,
        prompt: cleaned.prompt,
        dropped: cleaned.dropped,
      };
    }
    throw new Error(message);
  }
  return xaiImageFromResponse(data, payload && payload.prompt);
}

export async function generateXaiStasisImage(stasis, buzzWords, aspectRatio, referenceImage, cfOpts = {}) {
  return withVideoAuth(async function (apiKey) {
    const aspect = normalizeAspect(aspectRatio);
    const ref = String(referenceImage || "").trim();
    const wrapOpts = {
      signature: cfOpts.signature || cfOpts.signature_stamp || "",
      source: cfOpts.source || "",
    };
    const fullPrompt = ref
      ? buildFlashProjectPrompt(stasis, buzzWords, aspect, wrapOpts)
      : buildStasisVisionPrompt(stasis, buzzWords, aspect, wrapOpts);
    const base = {
      model: IMAGE_MODEL,
      prompt: fullPrompt,
      n: 1,
      aspect_ratio: aspect,
    };
    if (ref) {
      try {
        return await postXaiImage(
          API_IMAGE_EDITS,
          {
            ...base,
            image: { url: ref, type: "image_url" },
          },
          apiKey
        );
      } catch (errEdits) {
        try {
          return await postXaiImage(
            API_IMAGES,
            { ...base, image_url: ref },
            apiKey
          );
        } catch (errGen) {
          throw errEdits;
        }
      }
    }
    return postXaiImage(API_IMAGES, base, apiKey);
  });
}

/*
 * FLUX-friendly prompt for the Cloudflare fallback.
 * FLUX schnell reads a short plain description best (its text encoder only takes the first
 * ~256 tokens, and the opening words weigh most). The long xAI stasis prompt led with
 * meta-instructions ("NOT a remake… Do not preserve…") and, once clipped, lost Influence II/III
 * entirely. So: subject first in plain words, then medium/palette/mood/framing, one short
 * "no text" tail. The xAI prompt path does not use this.
 */
export const FLUX_PROMPT_TARGET = 1100;
const FLUX_META_RE =
  /\b(remake|restage|near-copy|collage|triptych|letterbox\w*|product-ready|for sale|motif dna|influence texts?|fusion directive|studio author|thumbnail|museum-quality|fill the (entire )?canvas|brand[- ]new|never existed|override|mandatory|repaint|seeded from|entire brief|invent it freely)\b/i;
const FLUX_NEGATIVE_START_RE = /^(no|never|do not|don't|avoid|without|introduce no)\b/i;
const FLUX_BUZZ_SKIP_RE =
  /^(original painting|brand new composition|invented scene|painting|art|artwork|three-tone palette|limited palette)$/i;
const FLUX_NON_PAINT_STYLE_RE = /\b(cgi|3d|render|photo\w*|digital|pixel|vector)\b/i;
const FLUX_MEDIUM_RE =
  /\b(oil|acrylic|watercolou?r|gouache|ink|pencil|charcoal|pastel|line[- ]art|sketch|fresco|tempera|woodcut|linocut|mosaic|photograph\w*|3d)\b/i;

function fluxSentences(text) {
  return String(text || "")
    .replace(/\s*\(#[0-9a-f]{3,8}\)/gi, "") // "Crimson Red (#C81D25)" -> "Crimson Red" (FLUX can't read hex)
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+(?=[A-Z0-9"“(«])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** "The painting portrays stylized figures…" -> "Stylized figures…" */
function fluxPlainLead(sentence) {
  const t = String(sentence || "").replace(
    /^(the|this|a|an)\s+(painting|image|artwork|piece|work|scene|composition|picture|illustration|render(ing)?)\s+(portrays|depicts|shows|features|presents|captures|illustrates|is of)\s+/i,
    ""
  );
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Leading whole sentences of `text` within `budget` chars; the first sentence is always kept whole. */
function fluxLeadSentences(text, budget) {
  const out = [];
  let len = 0;
  for (const raw of fluxSentences(text)) {
    const sent = fluxPlainLead(raw);
    if (out.length && len + 1 + sent.length > budget) break;
    out.push(sent);
    len += (out.length > 1 ? 1 : 0) + sent.length;
  }
  return out.join(" ");
}

function fluxDescFromSlotBody(body) {
  const paras = String(body || "")
    .split(/\n\s*\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  let title = "";
  const desc = [];
  for (let i = 0; i < paras.length; i++) {
    const para = paras[i];
    if (/^(style|tags|generation prompt|source \(verbatim\))\s*:/i.test(para)) continue;
    if (/^(generated still|phone upload|line sketch|inverted sketch)\b/i.test(para)) continue;
    if (/^\(description pending/i.test(para)) continue;
    if (i === 0 && !title && para.length <= 80 && !/[.!?]$/.test(para) && paras.length > 1) {
      title = para;
      continue;
    }
    desc.push(para);
  }
  return { title, desc: desc.join(" ") || title };
}

function fluxColorNames(text) {
  const names = [];
  const t = String(text || "");
  const add = (n) => {
    const v = String(n || "").replace(/\s+/g, " ").trim();
    if (v && v.length <= 40 && !names.some((x) => x.toLowerCase() === v.toLowerCase())) names.push(v);
  };
  let m;
  const labeled = /([A-Z][A-Za-z' -]{1,38}?)\s*\(#[0-9a-f]{3,8}\)/gi; // "Crimson Red (#C81D25)"
  while ((m = labeled.exec(t))) add(m[1].replace(/^.*[•:;]\s*/, ""));
  const toned = /#[0-9a-f]{3,8}\s*[—-]\s*([A-Za-z][A-Za-z' -]{1,38}?)\s*(?:\(|$|\n)/gim; // "#0E5E6F — Deep Teal ("
  while ((m = toned.exec(t))) add(m[1]);
  return names.slice(0, 6);
}

function fluxFraming(aspect) {
  const a = normalizeAspect(aspect);
  const [w, h] = a.split(":").map(Number);
  if (w === h) return "Square frame filled edge to edge.";
  // Do not say "landscape". That word makes the fallback paint hills.
  return w > h
    ? "Wide horizontal frame filled edge to edge, not a square."
    : "Tall vertical frame filled edge to edge, not a square.";
}

/** Spellforge auto-built stasis -> { subjects[], colors[], styles[], moods[], extra } or null. */
function parseSpellforgeStasis(stasis) {
  const text = String(stasis || "");
  if (!/SPELLFORGE PRODUCT|──\s*INFLUENCE\s+[IV]+|THREE IDENTITIES|SPELL (?:[1-9]|[IVX]+)\s*—|COMBINATION PIECE|Conjoined detail/.test(text)) return null;
  const subjects = [];
  const re =
    /(?:──\s*INFLUENCE\s+[IV]+[^\n]*──|SPELL (?:[1-9]|[IVX]+)\s*—[^\n]*)\s*\n([\s\S]*?)(?=\n\s*(?:──\s*INFLUENCE|SPELL (?:[1-9]|[IVX]+)\s*—|FUSION(?: DIRECTIVE)?:|FINAL OUTCOME\b|Output:|OUTPUT ASPECT|IN-CANVAS SIGNATURE|THE THREE IDENTITIES|Style DNA|Buzz words:)|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const d = fluxDescFromSlotBody(m[1]);
    if (d.desc && d.desc !== "(no description)") subjects.push(d);
  }
  if (!subjects.length) {
    const conj = /Conjoined detail[^:\n]*:\s*([^\n]+)/i.exec(text);
    if (conj) {
      conj[1]
        .replace(/\.\s*$/, "")
        .split(/\s*,?\s*together with\s+/i)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter((s) => s && s !== "(no description)")
        .forEach((desc) => subjects.push({ title: "", desc }));
    }
  }
  const line = (label) => {
    const r = new RegExp("^" + label + "[^:\\n]*:[ \\t]*([^\\n]+)", "m").exec(text);
    return r ? r[1].replace(/[.…]+$/, "").trim() : "";
  };
  const locksBlock = (/(MANDATORY[^\n]*\n?(?:\s*•[^\n]*\n?)*)/.exec(text) || [""])[0];
  return {
    subjects,
    colors: fluxColorNames(locksBlock),
    styles: line("Style DNA").split(/,\s*/).filter(Boolean),
    moods: line("Mood DNA").split(/\s*\+\s*/).filter(Boolean),
    extra: line("Extra direction"),
  };
}

/** Any other page's stasis (Colors, 0-Z, edited 4th description…): keep content, drop meta/negatives. */
function parseGenericStasis(stasis) {
  const raw = String(stasis || "");
  const colors = fluxColorNames(raw);
  const lines = raw.split(/\n+/).filter((l) => !/^\s*[•*-]\s/.test(l)); // bullet spec lines -> palette only
  const kept = [];
  const subjectFirst = [];
  for (const sent of fluxSentences(lines.join("\n"))) {
    let t = sent.replace(/^[A-Z0-9 '’&-]{6,}\s*[—:-]\s*/, ""); // drop "THREE-TONE PAINTING — " style headings
    if (!t || FLUX_META_RE.test(t) || FLUX_NEGATIVE_START_RE.test(t)) continue;
    if (/^subject(\s*roll)?\s*:/i.test(t) || /^prompt\s*:/i.test(t)) {
      t = t
        .replace(/^subject(\s*roll)?\s*:\s*(anything at all\s*[—-]\s*this time,\s*)?/i, "")
        .replace(/^prompt\s*(\([^)]*\))?\s*:\s*/i, "");
      subjectFirst.push(t.charAt(0).toUpperCase() + t.slice(1));
      continue;
    }
    kept.push(fluxPlainLead(t));
  }
  return { text: subjectFirst.concat(kept).join(" "), colors };
}

/** Words that end a trimmed clause badly ("…a fox with" -> "…a fox"). */
const FLUX_DANGLING_RE = /[\s,;:—–]+(and|or|with|while|of|in|on|at|to|by|for|from|the|a|an|its|their|as|that|which)?\s*$/i;

/** Core subject + key visual elements of one spell, bounded to `cap` chars (clause, then word boundary). */
function fluxSpellCore(desc, cap) {
  const sents = fluxSentences(desc)
    .filter((s) => !FLUX_META_RE.test(s) && !FLUX_NEGATIVE_START_RE.test(s))
    .map(fluxPlainLead);
  let out = "";
  for (const s of sents) {
    if (!out) out = s;
    else if (out.length + 1 + s.length <= cap) out += " " + s;
    else break;
  }
  if (out.length > cap) {
    const head = out.slice(0, cap + 1);
    let cut = -1;
    for (const b of [". ", "; ", ", ", " — ", " – ", ": ", " while ", " with ", " and "]) {
      const i = head.lastIndexOf(b);
      if (i >= cap * 0.5 && i > cut) cut = i;
    }
    if (cut < 0) cut = head.lastIndexOf(" ");
    out = out.slice(0, cut > 0 ? cut : cap);
    let prev;
    do {
      prev = out;
      out = out.replace(FLUX_DANGLING_RE, "");
    } while (out !== prev);
  }
  return out.replace(/[\s.…,;:]+$/, "").trim();
}

/** The user's own extra buzz words, verbatim (whitespace collapsed, trailing period dropped). */
function fluxExtraBuzz(v) {
  const raw = Array.isArray(v)
    ? v.map((x) => String(x || "").trim()).filter(Boolean).join(", ")
    : typeof v === "string"
      ? v
      : "";
  const t = raw.replace(/\s+/g, " ").replace(/[\s.…]+$/, "").trim();
  return t.length > FLUX_EXTRA_MAX ? clipPromptChars(t, FLUX_EXTRA_MAX).replace(/…$/, "") : t;
}

const FLUX_EXTRA_MAX = 800;
const FLUX_NUM_WORDS = ["", "one", "two", "three", "four", "five", "six"];

/**
 * opts.extraBuzz — the Spellforge "Extra buzz" field (request `extra_buzz`); falls back to the
 * stasis "Extra direction:" line. It is always included verbatim near the start of the prompt.
 * Spells get equal, bounded shares, mixed into one combination rather than painted as the first spell alone.
 */
export function buildCloudflarePrompt(stasis, buzzWords, aspect, opts = {}) {
  if (opts.source === "az") {
    const raw = fluxExtraBuzz((opts && opts.extraBuzz) || stasis);
    const scene = (raw.split(/[.!\n]/)[0] || raw).trim() || "a single form";
    return (
      scene +
      ". Black ink contour drawing of that exact subject on plain white paper. High-contrast black lines, no color, no hillside, no mountain unless those words are the subject. The only subject is: " +
      scene +
      "."
    );
  }
  const sf = parseSpellforgeStasis(stasis);
  const gen = sf && sf.subjects.length ? null : parseGenericStasis(stasis);
  const genExtra = gen ? (/^Extra direction[^:\n]*:[ \t]*([^\n]+)/m.exec(String(stasis || "")) || [])[1] : "";
  const extra = fluxExtraBuzz((opts && opts.extraBuzz) || (sf ? sf.extra : genExtra) || "");
  const colors = (sf ? sf.colors : gen.colors) || [];
  const moods = sf ? sf.moods.slice(0, 2) : [];
  const styles = sf ? sf.styles.filter((x) => !FLUX_NON_PAINT_STYLE_RE.test(x)).slice(0, 3) : [];
  const subjectText = gen ? gen.text.replace(/(^|\s)Extra direction[^:]*:[^.]*\.?/i, " ").trim() : "";
  const mediumNamed = FLUX_MEDIUM_RE.test(extra) || (gen && FLUX_MEDIUM_RE.test(subjectText));
  const medium = mediumNamed ? "A painting" : "An expressive fine-art oil painting";
  const extraLine = extra ? `Prominently featuring: ${extra}.` : "";

  const tail = [];
  if (!mediumNamed) tail.push("Visible brushstrokes.");
  if (styles.length) tail.push("Style influences: " + styles.join(", ").toLowerCase() + ".");
  if (colors.length) tail.push("Dominant colors: " + colors.join(", ") + ".");
  if (moods.length) tail.push("Mood: " + moods.join(", ").toLowerCase().replace(/[.…]+$/, "") + ".");
  tail.push(fluxFraming(aspect));
  const sig = String((opts && opts.signature) || "").trim();
  if (sig) {
    tail.push(`Small painted signature in the lower corner: "${sig}". No watermark.`);
  } else {
    tail.push("No watermark.");
  }
  const tailText = tail.join(" ");

  let prompt;
  if (sf && sf.subjects.length) {
    const subs = sf.subjects.slice(0, 4);
    const n = subs.length;
    const word = FLUX_NUM_WORDS[n] || String(n);
    const [frameW, frameH] = normalizeAspect(aspect).split(":").map(Number);
    const wide = frameW > frameH;
    // The user's words lead the prompt verbatim (FLUX weighs the opening most), are restated in the
    // opener, and each item is named again "in equal measure" in the closing line so a later item
    // is not drowned by the first one.
    const shortExtra = extra && extra.length <= 160;
    const items = extra.split(/\s*,\s*/).filter(Boolean);
    const rotated =
      items.length > 1 ? items.slice(0, -1).join(", ") + " and " + items[items.length - 1] + " in equal measure" : extra;
    const lead = extra ? (shortExtra ? extra.charAt(0).toUpperCase() + extra.slice(1) : extra) + "." : "";
    const opener =
      `${medium} of one combination in a single seamless scene` +
      (wide ? " in a wide horizontal frame" : "") +
      (shortExtra ? `, prominently featuring ${extra}, ${items.length > 1 ? "each" : ""} clearly visible,` : "") +
      (n > 1 ? ` mixing ${word} spells together.` : ` with one clear focal subject.`);
    const unifier =
      n > 1
        ? `Mix ${n === 2 ? "both" : "all " + word} into one combination painting, not a picture of only the first spell` +
          (shortExtra ? `, with ${rotated}.` : ".")
        : shortExtra
          ? `Surrounded by ${rotated}.`
          : "";
    const fixedLen = lead.length + opener.length + unifier.length + tailText.length + 20 * n + 8;
    const cap = Math.max(110, Math.min(n === 1 ? 420 : 260, Math.floor((FLUX_PROMPT_TARGET - fixedLen) / n)));
    // Balance: every spell gets the same bounded share, and none may run much longer than the
    // shortest one (a long first sentence is trimmed to its core clause).
    let cores = subs.map((d) => fluxSpellCore(d.desc, cap));
    if (n > 1) {
      const shortest = Math.min(...cores.map((c) => c.length));
      const even = Math.max(120, Math.round(shortest * 1.3));
      if (cores.some((c) => c.length > even)) cores = subs.map((d) => fluxSpellCore(d.desc, Math.min(cap, even)));
    }
    const lcArticle = (c) => c.replace(/^(A|An|The|Two|Three|Several|Many)\b/, (w) => w.toLowerCase());
    const body =
      n > 1
        ? cores.map((c, i) => (i === 0 ? c : "mixed with " + lcArticle(c))).join(", ") + "."
        : "At the center, " + lcArticle(cores[0] || "") + ".";
    // The three spell references lead. The scene outcome follows them.
    prompt = [body, lead, opener.replace(/,\s+clearly/, ", clearly").replace(/\s+,/g, ","), unifier, tailText]
      .filter(Boolean)
      .join(" ");
  } else {
    const budget = Math.max(300, FLUX_PROMPT_TARGET - tailText.length - extraLine.length - medium.length - 80);
    let subject = fluxLeadSentences(subjectText, budget);
    const subjectMax = CF_PROMPT_MAX - tailText.length - extraLine.length - medium.length - 8;
    if (subject.length > subjectMax) subject = clipPromptChars(subject, subjectMax);
    const lower = (subject + " " + extra).toLowerCase();
    const details = (buzzWords || [])
      .map((b) => String(b || "").trim())
      .filter((b) => b && !/^#?[0-9a-f]{6}$/i.test(b) && !/\d+\s*[:/]\s*\d+|aspect/i.test(b))
      .filter((b) => !FLUX_BUZZ_SKIP_RE.test(b) && !lower.includes(b.toLowerCase()))
      .filter((b) => !colors.some((c) => c.toLowerCase() === b.toLowerCase()))
      .slice(0, 6);
    const detailText = details.length ? "Details: " + details.join(", ") + "." : "";
    const lead = FLUX_MEDIUM_RE.test(subject) ? "" : medium + ".";
    prompt = [extraLine, subject, detailText, lead, tailText].filter(Boolean).join(" ");
    if (prompt.replace(/\s+/g, " ").length > CF_PROMPT_MAX) prompt = [extraLine, subject, lead, tailText].filter(Boolean).join(" ");
  }
  prompt = prompt.replace(/\s+/g, " ").trim();
  if (prompt.length > CF_PROMPT_MAX) {
    // Only reachable with a huge extra + long run-on text; keep extra and the tail.
    prompt = clipPromptChars(prompt.slice(0, prompt.length - tailText.length), CF_PROMPT_MAX - tailText.length - 1) + " " + tailText;
  }
  return prompt;
}

/**
 * flux-1-schnell accepts prompt and steps only. width and height are rejected.
 * Other models keep a size. A negative step count flips back to a positive one.
 */
export function cloudflareImagePayload(model, prompt, aspect) {
  const body = { prompt: String(prompt || "") };
  if (/flux-1-schnell/i.test(String(model || ""))) {
    body.steps = getCfFluxSteps();
    return body;
  }
  const sized = aspectToSize(aspect, 1024);
  body.width = Math.max(256, Math.floor(sized.width / 8) * 8);
  body.height = Math.max(256, Math.floor(sized.height / 8) * 8);
  if (/flux/i.test(String(model || ""))) body.steps = getCfFluxSteps();
  return body;
}

/** Remove fields the model called not allowed, so the same request can run. */
export function omitRejectedFields(payload, message) {
  const src = payload && typeof payload === "object" ? payload : null;
  if (!src) return null;
  const text = String(message || "");
  if (!/not allowed|unevaluated propert|additional propert/i.test(text)) return null;
  const next = { ...src };
  let changed = false;
  const re = /\/([A-Za-z_][A-Za-z0-9_]*)/g;
  let match;
  while ((match = re.exec(text))) {
    if (Object.prototype.hasOwnProperty.call(next, match[1])) {
      delete next[match[1]];
      changed = true;
    }
  }
  return changed ? next : null;
}

async function postCloudflareImage(creds, model, payload) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    creds.accountId
  )}/ai/run/${model}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const type = String(resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (resp.ok && type.startsWith("image/")) {
    // SDXL (and other binary models) return raw image bytes, usually PNG.
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 32) throw new Error("Cloudflare Workers AI returned an empty image.");
    return `data:${type};base64,${buf.toString("base64")}`;
  }
  const data = await resp.json().catch(function () {
    return {};
  });
  if (!resp.ok || data.success === false) {
    const msg = (data.errors && data.errors[0] && data.errors[0].message) || `HTTP ${resp.status}`;
    throw new Error(`Cloudflare Workers AI: ${msg}`);
  }
  const image = data.result && data.result.image;
  if (!image) throw new Error("Cloudflare Workers AI returned no image.");
  return String(image).startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;
}

/** Text-to-image via Cloudflare Workers AI REST. Reference images are ignored. Returns a data: URL. */
export async function generateCloudflareStasisImage(stasis, buzzWords, aspectRatio, opts = {}) {
  const creds = getCfCreds();
  if (!creds) {
    throw new Error(
      "Cloudflare Workers AI is not configured (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)."
    );
  }
  const model = getCfImageModel();
  const aspect = normalizeAspect(aspectRatio);
  let payload = cloudflareImagePayload(
    model,
    buildCloudflarePrompt(stasis, buzzWords, aspect, opts),
    aspect
  );
  try {
    return await postCloudflareImage(creds, model, payload);
  } catch (err) {
    const trimmed = omitRejectedFields(payload, err && err.message);
    if (!trimmed) throw err;
    return postCloudflareImage(creds, model, trimmed);
  }
}

/**
 * Text-to-image via Pollinations' documented GET /image/{prompt} with a Bearer `sk_` key.
 * Same prompt as the Cloudflare path; the image is downloaded here and returned as a data: URL.
 */
export async function generatePollinationsStasisImage(stasis, buzzWords, aspectRatio, opts = {}) {
  const key = getPollinationsKey();
  if (!key) throw new Error("Pollinations is not configured (set POLLINATIONS_API_KEY).");
  const aspect = normalizeAspect(aspectRatio);
  const sized = aspectToSize(aspect, 1024);
  const params = new URLSearchParams({
    model: getPollinationsModel(),
    width: String(Math.max(256, Math.round(sized.width / 16) * 16)),
    height: String(Math.max(256, Math.round(sized.height / 16) * 16)),
    seed: String(Math.floor(Math.random() * 2147483646) + 1),
    safe: "sexual",
  });
  const prompt = buildCloudflarePrompt(stasis, buzzWords, aspect, opts);
  const url = POLLINATIONS_IMAGE_URL + encodeURIComponent(prompt) + "?" + params.toString();
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutMs = getPollinationsTimeoutMs();
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let resp;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl ? ctrl.signal : undefined,
    });
    const type = String(resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (resp.ok && type.startsWith("image/")) {
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 32) throw new Error("Pollinations returned an empty image.");
      return `data:${type};base64,${buf.toString("base64")}`;
    }
    const data = await resp.json().catch(function () {
      return {};
    });
    const msg =
      (data && data.error && (data.error.message || (typeof data.error === "string" ? data.error : ""))) ||
      (data && data.message) ||
      `HTTP ${resp.status}`;
    throw new Error(`Pollinations: ${msg}`);
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error(`Pollinations: timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Cloudflare, then Pollinations. A closed balance or a rejected field does not become the status text. */
async function generateFreeFallbackImage(stasis, buzzWords, aspectRatio, cfOpts) {
  let cfErr = null;
  if (getCfCreds()) {
    try {
      return await generateCloudflareStasisImage(stasis, buzzWords, aspectRatio, cfOpts);
    } catch (e) {
      cfErr = e;
    }
  }
  if (getPollinationsKey()) {
    try {
      return await generatePollinationsStasisImage(stasis, buzzWords, aspectRatio, cfOpts);
    } catch (pErr) {
      const err = cfErr || pErr || new Error("combination-still-painting");
      err.fallbackReasons = true;
      throw err;
    }
  }
  throw cfErr || new Error("combination-still-painting");
}

/** xAI failures that should hand off to the free Cloudflare fallback. */
export function shouldUseCloudflareFallback(err) {
  const m = String(err && err.message ? err.message : err || "").toLowerCase();
  return (
    isCreditsLimitError(err) ||
    isInvalidKeyError(err) ||
    m.includes("no xai api key") ||
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("quota") ||
    m.includes("at capacity") ||
    m.includes("temporarily") ||
    m.includes("insufficient balance")
  );
}

export async function generateStasisVisionImage(stasis, buzzWords, aspectRatio, referenceImage, cfOpts = {}) {
  const provider = getImageProvider();
  if (provider === "pollinations") {
    return generatePollinationsStasisImage(stasis, buzzWords, aspectRatio, cfOpts);
  }
  if (provider === "cloudflare") {
    if (!getPollinationsKey()) return generateCloudflareStasisImage(stasis, buzzWords, aspectRatio, cfOpts);
    return generateFreeFallbackImage(stasis, buzzWords, aspectRatio, cfOpts);
  }
  if (provider === "wombo") {
    return generateWomboStasisImage(stasis, buzzWords, aspectRatio);
  }
  try {
    return await generateXaiStasisImage(stasis, buzzWords, aspectRatio, referenceImage, cfOpts);
  } catch (err) {
    if ((getCfCreds() || getPollinationsKey()) && shouldUseCloudflareFallback(err)) {
      try {
        return await generateFreeFallbackImage(stasis, buzzWords, aspectRatio, cfOpts);
      } catch (fbErr) {
        if (isCreditsLimitError(err) && getWomboKey()) {
          return generateWomboStasisImage(stasis, buzzWords, aspectRatio);
        }
        const quiet = new Error("combination-still-painting");
        quiet.cause = fbErr || err;
        throw quiet;
      }
    }
    if (isCreditsLimitError(err) && getWomboKey()) {
      return generateWomboStasisImage(stasis, buzzWords, aspectRatio);
    }
    if (shouldTryGrokLogin(err) || shouldUseCloudflareFallback(err)) {
      const quiet = new Error("combination-still-painting");
      quiet.cause = err;
      throw quiet;
    }
    throw err;
  }
}