// Shared by presence.mjs and server-window.mjs: the "who is online" list.
// Each presence entry may carry the visitor's chosen name and their last
// generated still. Sessions are identified publicly by a hash of the session id
// (the raw sid stays private, so nobody can rename or post as someone else).

export const NAME_MAX = 32;
export const PROMPT_MAX = 800;
const PID_RE = /^[a-f0-9]{16}$/;
const TAB_RE = /^[a-z0-9-]{1,40}$/;

/** Visible name: no control / bidi / zero-width characters, no angle brackets, capped. */
export function cleanName(raw) {
  let s = String(raw == null ? "" : raw);
  try {
    s = s.normalize("NFKC");
  } catch (e) {}
  s = s
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(s).slice(0, NAME_MAX).join("").trim();
}

export function cleanPrompt(raw) {
  const s = String(raw == null ? "" : raw)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  return Array.from(s).slice(0, PROMPT_MAX).join("");
}

export function isPid(pid) {
  return PID_RE.test(String(pid || ""));
}

/** Public id for a session id: first 16 hex chars of SHA-256("l7in-online:" + sid). */
export async function pidOf(sid) {
  const bytes = new TextEncoder().encode("l7in-online:" + String(sid || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function cleanTab(raw) {
  const tab = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
  return TAB_RE.test(tab) ? tab : "gallery";
}

function cleanRemote(raw) {
  const s = String(raw || "").trim();
  if (!/^https:\/\//i.test(s) || s.length > 2000) return "";
  if (/[\s"'<>]/.test(s)) return "";
  if (/\.(?:mp4|webm|mov)(?:\?|$)/i.test(s)) return "";
  return s;
}

/**
 * A visitor's last generated still, as kept in the presence map:
 * { at, tab, name (as it was when they generated), image: true } for a copy
 * stored by server-window, or { ..., remote: "https://..." }.
 */
export function cleanLast(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const at = parseInt(raw.at, 10) || 0;
  if (!at || at > now + 60000) return null;
  const remote = raw.image ? "" : cleanRemote(raw.remote);
  if (!raw.image && !remote) return null;
  const last = { at, tab: cleanTab(raw.tab), name: cleanName(raw.name) || "guest" };
  if (raw.image) last.image = true;
  else last.remote = remote;
  return last;
}

/** Online users for the client list, oldest arrival first. */
export function usersOf(map) {
  const out = [];
  for (const info of Object.values(map || {})) {
    if (!info || typeof info !== "object" || !isPid(info.pid)) continue;
    const user = {
      id: info.pid,
      name: cleanName(info.name) || "guest",
      tab: cleanTab(info.tab),
      since: parseInt(info.since, 10) || parseInt(info.ts, 10) || 0,
    };
    const last = cleanLast(info.last);
    if (last) user.last = last;
    out.push(user);
  }
  out.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
  return out;
}
