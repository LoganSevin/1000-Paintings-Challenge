import { getStore } from "@netlify/blobs";
import {
  generateStasisVisionImage,
  saveJob,
  jsonResponse,
  corsPreflight,
  visitorXaiKey,
  runWithXaiKey,
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
    return corsPreflight();
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

  const visitorKey = visitorXaiKey(request);
  if (!visitorKey) {
    return jsonResponse(
      {
        error:
          "Connect your xAI API key after Google Sign-In. logan7in.art does not use the artist's Grok credits.",
      },
      401
    );
  }

  const store = getStore({ name: "spellforge-jobs", consistency: "strong" });
  await saveJob(store, jobId, { id: jobId, type: "stasis_vision", status: "queued" });

  const work = runWithXaiKey(visitorKey, () => runJob(jobId, body));
  if (context?.waitUntil) {
    context.waitUntil(work);
  } else {
    await work;
  }

  return jsonResponse({ job_id: jobId, status: "queued" }, 202);
}