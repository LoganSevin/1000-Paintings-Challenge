import { jsonResponse, corsPreflight } from "./_lib.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const credential = String(body.credential || "").trim();
  if (!credential) return jsonResponse({ error: "Missing credential" }, 400);

  const expected = String(process.env.GOOGLE_CLIENT_ID || process.env.PULSE_GOOGLE_CLIENT_ID || "").trim();
  const infoUrl = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential);
  const resp = await fetch(infoUrl);
  const info = await resp.json().catch(() => ({}));
  if (!resp.ok || !info.sub) {
    return jsonResponse({ error: info.error_description || "Google token was rejected." }, 401);
  }
  if (expected && info.aud !== expected) {
    return jsonResponse({ error: "Google client ID does not match this site." }, 401);
  }

  return jsonResponse({
    ok: true,
    user: {
      sub: info.sub,
      email: info.email || "",
      name: info.name || info.email || "Visitor",
      picture: info.picture || "",
    },
  });
}
