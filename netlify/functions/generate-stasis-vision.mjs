import { getStore } from "@netlify/blobs";
import {
  isImageApiConfigured,
  generateStasisVisionImage,
  saveJob,
  jsonResponse,
} from "./_lib.mjs";

async function runJob(jobId, body) {
  const store = getStore({ name: "spellforge-jobs", consistency: "strong" });
  try {
    const stasis = (body.stasis || "").trim();
    if (!stasis) throw new Error("Stasis text is empty.");

    let buzz = body.buzz_words || body.tags || [];
    if (typeof buzz === "string") {
      buzz = buzz.split(",").map((s) => s.trim()).filter(Boolean);
    }

    await saveJob(store, jobId, { id: jobId, type: "stasis_vision", status: "pending" });

    const imageUrl = await generateStasisVisionImage(stasis, buzz);
    const image = { url: imageUrl };
    await saveJob(store, jobId, {
      id: jobId,
      type: "stasis_vision",
      status: "done",
      image,
      images: [image],
    });
  } catch (e) {
    await saveJob(store, jobId, {
      id: jobId,
      type: "stasis_vision",
      status: "failed",
      error: { message: e.message || String(e) },
    });
  }
}

export default async function handler(request, context) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const jobId =
    body.job_id ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `job-${Date.now()}`);

  if (!isImageApiConfigured()) {
    return jsonResponse(
      {
        error:
          "No image API key. Add WOMBO_DREAM_API_KEY or XAI_API_KEY on Netlify, set SPELLFORGE_IMAGE_PROVIDER=wombo if using WOMBO, then redeploy.",
      },
      400
    );
  }

  const store = getStore({ name: "spellforge-jobs", consistency: "strong" });
  await saveJob(store, jobId, { id: jobId, type: "stasis_vision", status: "queued" });

  const work = runJob(jobId, body);
  if (context?.waitUntil) {
    context.waitUntil(work);
  } else {
    await work;
  }

  return jsonResponse({ job_id: jobId, status: "queued" }, 202);
}