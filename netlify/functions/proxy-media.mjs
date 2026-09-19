import { corsPreflight, jsonResponse } from "./_lib.mjs";

function allowedUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || ""));
  } catch (e) {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "logan7in.art" || host === "www.logan7in.art") return true;
  if (host.endsWith(".netlify.app")) return true;
  return false;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method !== "GET") return jsonResponse({ error: "GET required" }, 405);
  const url = new URL(request.url).searchParams.get("url") || "";
  if (!allowedUrl(url)) {
    return jsonResponse({ error: "URL not allowed." }, 400);
  }
  try {
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) {
      return jsonResponse({ error: "Upstream HTTP " + resp.status }, resp.status);
    }
    const buf = await resp.arrayBuffer();
    const type = String(resp.headers.get("content-type") || "image/jpeg").split(";")[0];
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return jsonResponse({ error: e.message || String(e) }, 502);
  }
}
