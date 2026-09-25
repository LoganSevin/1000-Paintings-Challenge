import { Buffer } from "node:buffer";
import { jsonResponse, corsPreflight } from "./_lib.mjs";
import { decodeDataUrl, phoneStore, savePhoneImage } from "./_transfer-store.mjs";

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-File-Name, X-Visitor-Xai-Key");
  return new Response(res.body, { status: res.status, headers });
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method !== "POST") return noStore({ ok: false, error: "POST required" }, 405);
  try {
    const store = phoneStore();
    const ctype = String(request.headers.get("content-type") || "").toLowerCase();
    let buf;
    let mime = "image/jpeg";
    let name = request.headers.get("x-file-name") || "upload.jpg";
    try {
      name = decodeURIComponent(name);
    } catch (e) {}
    if (ctype.includes("application/json")) {
      const text = await request.text();
      let body = {};
      try {
        body = JSON.parse(text || "{}");
      } catch (e) {
        return noStore({ ok: false, error: "Invalid JSON" }, 400);
      }
      const decoded = decodeDataUrl(body.image_base64 || body.data || body.image || "");
      if (!decoded) return noStore({ ok: false, error: "Provide a photo" }, 400);
      buf = decoded.buf;
      mime = decoded.mime;
      name = body.name || body.filename || name;
    } else {
      const ab = await request.arrayBuffer();
      buf = Buffer.from(ab);
      if (ctype.startsWith("image/")) mime = ctype.split(";")[0].trim();
    }
    const result = await savePhoneImage(store, buf, mime, name);
    return noStore(result);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    return noStore({ ok: false, error: (err && err.message) || "Upload failed" }, status);
  }
}
