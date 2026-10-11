import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

// Everyone who has opened the console, including people who have since left.
// A fresh heartbeat is online. Closing the site, or going quiet, moves them
// offline and keeps the name, tab, and last still so the roster can account
// for them. The corner window still has its own shared still.
const STORE = "server-people";
const ROSTER_KEY = "roster";
const MAIL_KEY = "mail";
const TTL_MS = 90000;
const MAX_KEEP = 120;
const MAIL_KEEP = 200;
const MAIL_COOLDOWN_MS = 1500;
const MAX_NAME = 32;
const MAX_TEXT = 200;
const SID_RE = /^[A-Za-z0-9._-]{8,80}$/;
const MAX_IMAGE_BYTES = 670000;

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}

function stillKey(sid) {
  return "still-" + sid;
}

function guestName(sid) {
  const tail = String(sid || "").replace(/[^A-Za-z0-9]/g, "").slice(-4);
  return "guest-" + (tail || "0000");
}

function cleanName(raw, sid) {
  const name = String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME)
    .trim();
  return name || guestName(sid);
}

function cleanTab(raw) {
  let tab = String(raw || "")
    .toLowerCase()
    .replace(/^#/, "")
    .split("?")[0]
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
  if (tab === "0-z" || tab === "zeroz" || tab === "0z") tab = "az";
  if (tab === "kjv" || tab === "scripture") tab = "bible";
  if (tab === "rooms") tab = "places";
  if (!tab || tab === "subscribe") tab = "gallery";
  return tab;
}

function cleanText(raw) {
  return String(raw || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

function b64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeImage(input) {
  const s = String(input || "").trim();
  const m = s.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const b64 = m[2].replace(/\s/g, "");
  if (!b64 || b64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8) return null;
  let bytes;
  try {
    bytes = b64ToBytes(b64);
  } catch (e) {
    return null;
  }
  if (!bytes || bytes.length < 16 || bytes.length > MAX_IMAGE_BYTES) return null;
  const type = m[1].toLowerCase();
  if (type === "image/jpeg" && !(bytes[0] === 0xff && bytes[1] === 0xd8)) return null;
  if (type === "image/png" && bytes[0] !== 0x89) return null;
  if (type === "image/webp") {
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (tag !== "RIFF") return null;
  }
  return { bytes, type };
}

async function readRoster(store) {
  try {
    const raw = await store.get(ROSTER_KEY, { type: "json" });
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw;
  } catch (e) {
    return {};
  }
}

async function readMail(store) {
  try {
    const raw = await store.get(MAIL_KEY, { type: "json" });
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function toPeople(roster) {
  return Object.entries(roster)
    .map(([sid, info]) => ({
      sid,
      name: info.name,
      seen: info.seen,
      stillAt: info.stillAt || 0,
      tab: info.tab || "gallery",
      online: !info.offline,
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || b.seen - a.seen || a.name.localeCompare(b.name));
}

function mailFor(mail, sid) {
  if (!sid) return [];
  return mail
    .filter((m) => m && (m.to === sid || m.from === sid))
    .slice(-40)
    .map((m) => ({
      id: m.id,
      from: m.from,
      fromName: m.fromName,
      to: m.to,
      text: m.text,
      ts: m.ts,
    }));
}

async function prune(roster, store) {
  const now = Date.now();
  const entries = [];
  for (const [sid, info] of Object.entries(roster)) {
    if (!SID_RE.test(sid) || !info || typeof info !== "object") continue;
    const seen = parseInt(info.seen, 10) || 0;
    if (!seen) continue;
    const offline = info.offline === true || now - seen > TTL_MS;
    entries.push([
      sid,
      {
        name: cleanName(info.name, sid),
        seen,
        stillAt: parseInt(info.stillAt, 10) || 0,
        type: String(info.type || ""),
        tab: cleanTab(info.tab || "gallery"),
        offline,
        mailAt: parseInt(info.mailAt, 10) || 0,
      },
    ]);
  }
  const online = entries.filter((entry) => !entry[1].offline).sort((a, b) => b[1].seen - a[1].seen);
  const offline = entries.filter((entry) => entry[1].offline).sort((a, b) => b[1].seen - a[1].seen);
  const kept = online.concat(offline).slice(0, MAX_KEEP);
  const keepSet = new Set(kept.map((entry) => entry[0]));
  const next = {};
  for (const [sid, info] of kept) next[sid] = info;
  for (const sid of Object.keys(roster)) {
    if (keepSet.has(sid)) continue;
    try {
      await store.delete(stillKey(sid));
    } catch (e) {}
  }
  return next;
}

async function readBytes(store, sid) {
  try {
    const data = await store.get(stillKey(sid), { type: "arrayBuffer" });
    if (!data) return null;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  } catch (e) {
    return null;
  }
}

async function readBody(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();

  const url = new URL(request.url);
  const store = getStore({ name: STORE, consistency: "strong" });

  if (request.method === "GET" && url.searchParams.get("image") === "1") {
    const sid = String(url.searchParams.get("sid") || "");
    if (!SID_RE.test(sid)) return noStore({ ok: false, error: "Unknown person" }, 400);
    const roster = await prune(await readRoster(store), store);
    const info = roster[sid];
    const bytes = info && info.type ? await readBytes(store, sid) : null;
    if (!info || !info.type || !bytes || bytes.length < 16) {
      return noStore({ ok: false, error: "No still" }, 404);
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": info.type || "image/jpeg",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (request.method === "GET") {
    const roster = await prune(await readRoster(store), store);
    const sid = String(url.searchParams.get("sid") || "");
    try {
      await store.setJSON(ROSTER_KEY, roster);
    } catch (e) {}
    const mail = SID_RE.test(sid) ? mailFor(await readMail(store), sid) : [];
    return noStore({ ok: true, people: toPeople(roster), mail });
  }

  if (request.method !== "POST") {
    return noStore({ ok: false, error: "Method not allowed" }, 405);
  }

  const body = await readBody(request);
  if (!body || typeof body !== "object") {
    return noStore({ ok: false, error: "Invalid JSON" }, 400);
  }
  const sid = String(body.sid || "");
  if (!SID_RE.test(sid)) return noStore({ ok: false, error: "Unknown person" }, 400);

  let roster = await prune(await readRoster(store), store);

  if (body.leave === true) {
    if (roster[sid]) roster[sid] = Object.assign({}, roster[sid], { offline: true });
    try {
      await store.setJSON(ROSTER_KEY, roster);
    } catch (e) {
      return noStore({ ok: false, error: "Store failed" }, 500);
    }
    return noStore({
      ok: true,
      people: toPeople(roster),
      mail: mailFor(await readMail(store), sid),
    });
  }

  const wantsMail = body.to != null || body.text != null;
  let mailTo = "";
  let mailText = "";
  if (wantsMail) {
    mailTo = String(body.to || "");
    mailText = cleanText(body.text);
    if (!SID_RE.test(mailTo)) return noStore({ ok: false, error: "Unknown person" }, 400);
    if (!mailText) return noStore({ ok: false, error: "Message required" }, 400);
    const prevMail = roster[sid];
    const mailAt = prevMail ? parseInt(prevMail.mailAt, 10) || 0 : 0;
    if (mailAt && Date.now() - mailAt < MAIL_COOLDOWN_MS) {
      return noStore({ ok: false, error: "Slow down" }, 429);
    }
  }

  const image = body.image ? decodeImage(body.image) : null;
  if (body.image && !image) {
    return noStore({ ok: false, error: "Image required" }, 400);
  }

  const prev = roster[sid] || {};
  const now = Date.now();
  const nextInfo = {
    name: cleanName(body.name, sid),
    seen: now,
    stillAt: parseInt(prev.stillAt, 10) || 0,
    type: String(prev.type || ""),
    tab: cleanTab(body.tab || prev.tab || "gallery"),
    offline: false,
    mailAt: wantsMail ? now : parseInt(prev.mailAt, 10) || 0,
  };
  if (image) {
    nextInfo.stillAt = now;
    nextInfo.type = image.type;
  }
  roster[sid] = nextInfo;
  roster = await prune(roster, store);

  let mail = await readMail(store);
  if (wantsMail) {
    mail = mail
      .concat([
        {
          id: now.toString(36) + Math.random().toString(36).slice(2, 8),
          from: sid,
          fromName: nextInfo.name,
          to: mailTo,
          text: mailText,
          ts: now,
        },
      ])
      .slice(-MAIL_KEEP);
  }

  try {
    if (image) await store.set(stillKey(sid), image.bytes);
    await store.setJSON(ROSTER_KEY, roster);
    if (wantsMail) await store.setJSON(MAIL_KEY, mail);
  } catch (e) {
    return noStore({ ok: false, error: "Store failed" }, 500);
  }

  return noStore({ ok: true, people: toPeople(roster), mail: mailFor(mail, sid) });
}
