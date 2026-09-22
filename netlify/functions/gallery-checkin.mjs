import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const store = getStore({ name: "gallery-meta", consistency: "strong" });
  let count = 0;
  try {
    const raw = await store.get("checkins");
    count = parseInt(raw || "0", 10) || 0;
  } catch (e) {
    count = 0;
  }
  if (request.method === "POST") {
    count += 1;
    await store.set("checkins", String(count));
  }
  return jsonResponse({ ok: true, count });
}
