import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }
  const username = String(body.username || "").trim().slice(0, 80);
  const text = String(body.text || "").trim().slice(0, 2000);
  const image = String(body.image_base64 || "");
  if (!username) return jsonResponse({ ok: false, error: "Name is required." }, 400);
  if (!text && !image) return jsonResponse({ ok: false, error: "Write a request or attach a drawing." }, 400);
  const store = getStore({ name: "pulse-feed", consistency: "strong" });
  let posts = [];
  try {
    const raw = await store.get("posts", { type: "json" });
    if (Array.isArray(raw)) posts = raw;
  } catch (e) {
    posts = [];
  }
  const entry = {
    id: "p-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    username,
    text,
    image_url: image && image.startsWith("data:") ? image : "",
    created_at: new Date().toISOString(),
    likes: [],
    comments: [],
    kind: body.kind || "feature",
  };
  posts.push(entry);
  if (posts.length > 300) posts = posts.slice(-300);
  await store.setJSON("posts", posts);
  return jsonResponse({ ok: true, post: entry });
}
