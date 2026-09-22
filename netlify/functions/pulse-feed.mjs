import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const store = getStore({ name: "pulse-feed", consistency: "strong" });
  let posts = [];
  try {
    const raw = await store.get("posts", { type: "json" });
    if (Array.isArray(raw)) posts = raw;
  } catch (e) {
    posts = [];
  }
  return jsonResponse({ ok: true, posts: posts.slice(-200).reverse() });
}
