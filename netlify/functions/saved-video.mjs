import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";
import {
  STORE_NAME,
  planByteRange,
  readClipBytes,
  clipContentType,
} from "./save-video.mjs";

function clipName(request, context) {
  const params = (context && context.params) || {};
  const fromParam = params.name || params.splat || "";
  const raw = fromParam
    ? String(fromParam)
    : (new URL(request.url).pathname.match(/\/(?:saved-videos|saved-video)\/([^/?#]+)/) || [])[1] || "";
  let name = "";
  try {
    name = decodeURIComponent(raw);
  } catch (e) {
    name = raw;
  }
  name = name.split("/")[0].toLowerCase();
  if (!/^\d+\.(mp4|webm)$/.test(name)) return "";
  return name;
}

export default async function handler(request, context) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ ok: false, error: "GET required" }, 405);
  }
  const name = clipName(request, context);
  if (!name) return jsonResponse({ ok: false, error: "Video not found." }, 404);
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const bytes = await readClipBytes(store, name);
  if (!bytes || bytes.length < 12) return jsonResponse({ ok: false, error: "Video not found." }, 404);
  const plan = planByteRange(bytes.length, request.headers.get("range"));
  if (!plan || plan.error) {
    return new Response(JSON.stringify({ ok: false, error: "Range not satisfiable" }), {
      status: 416,
      headers: {
        "Content-Type": "application/json",
        "Content-Range": "bytes */" + bytes.length,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  const slice = bytes.subarray(plan.start, plan.end + 1);
  const headers = {
    "Content-Type": clipContentType(name),
    "Content-Length": String(slice.byteLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    Vary: "Range",
    "Access-Control-Allow-Origin": "*",
  };
  if (plan.status === 206) {
    headers["Content-Range"] = "bytes " + plan.start + "-" + plan.end + "/" + bytes.length;
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: plan.status, headers });
  }
  return new Response(slice, { status: plan.status, headers });
}
