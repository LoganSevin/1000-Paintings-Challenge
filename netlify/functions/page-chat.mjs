import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

const ROOM_RE = /^[a-z0-9-]{1,40}$/;
const MAX_MESSAGES = 200;
const MAX_TEXT = 280;
const MAX_NAME = 32;
const COOLDOWN_MS = 2000;
const ROOM_PREFIX = "room/";
const RATE_PREFIX = "rl/";

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}

function clientIp(request) {
  const h = request.headers;
  const raw =
    h.get("x-nf-client-connection-ip") ||
    h.get("x-forwarded-for") ||
    h.get("client-ip") ||
    "";
  const first = String(raw).split(",")[0].trim();
  return first || "unknown";
}

function ipKey(ip) {
  // Keep blob keys filesystem-safe; avoid storing raw IPs with colons/slashes.
  return RATE_PREFIX + String(ip || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

function normalizeRoom(raw) {
  const room = String(raw || "")
    .toLowerCase()
    .replace(/^#/, "")
    .split("?")[0]
    .trim();
  if (room === "0-z" || room === "zeroz" || room === "0z") return "az";
  if (room === "kjv" || room === "scripture") return "bible";
  if (room === "rooms") return "places";
  if (!room || room === "subscribe") return "gallery";
  return room;
}

function sanitizeMessage(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").slice(0, 48);
  const name = stripTags(entry.name).slice(0, MAX_NAME) || "guest";
  const text = stripTags(entry.text).slice(0, MAX_TEXT);
  const ts = parseInt(entry.ts, 10) || 0;
  if (!id || !text || !ts) return null;
  return { id, name, text, ts };
}

async function loadMessages(store, room) {
  try {
    const raw = await store.get(ROOM_PREFIX + room, { type: "json" });
    if (!Array.isArray(raw)) return [];
    return raw.map(sanitizeMessage).filter(Boolean).slice(-MAX_MESSAGES);
  } catch (e) {
    return [];
  }
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();

  const store = getStore({ name: "page-chat", consistency: "strong" });
  const url = new URL(request.url);

  if (request.method === "GET") {
    const room = normalizeRoom(url.searchParams.get("room") || "gallery");
    if (!ROOM_RE.test(room)) return noStore({ ok: false, error: "Invalid room" }, 400);
    const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
    const messages = await loadMessages(store, room);
    const filtered = since > 0 ? messages.filter((m) => m.ts > since) : messages;
    return noStore({ ok: true, room, messages: filtered });
  }

  if (request.method !== "POST") {
    return noStore({ ok: false, error: "Method not allowed" }, 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return noStore({ ok: false, error: "Invalid JSON" }, 400);
  }

  const room = normalizeRoom(body.room || "gallery");
  if (!ROOM_RE.test(room)) return noStore({ ok: false, error: "Invalid room" }, 400);

  const name = stripTags(body.name).slice(0, MAX_NAME) || "guest";
  const text = stripTags(body.text).slice(0, MAX_TEXT);
  if (!text) return noStore({ ok: false, error: "Message required" }, 400);
  if (text.length > MAX_TEXT) return noStore({ ok: false, error: "Too long" }, 400);

  const ip = clientIp(request);
  const now = Date.now();
  const rk = ipKey(ip);
  try {
    const prev = await store.get(rk, { type: "json" });
    const last = prev && typeof prev === "object" ? parseInt(prev.t, 10) || 0 : 0;
    if (last && now - last < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
      return noStore({ ok: false, error: "Slow down — try again in " + wait + "s", retry_after: wait }, 429);
    }
  } catch (e) {
    /* ignore rate-store miss */
  }

  const entry = {
    id: "m-" + now + "-" + Math.random().toString(36).slice(2, 8),
    name,
    text,
    ts: now,
  };

  let messages = await loadMessages(store, room);
  messages.push(entry);
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
  await store.setJSON(ROOM_PREFIX + room, messages);
  try {
    await store.setJSON(rk, { t: now });
  } catch (e) {
    /* rate limit write is best-effort */
  }

  return noStore({ ok: true, room, message: entry });
}
