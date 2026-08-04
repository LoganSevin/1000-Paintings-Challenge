import { getStore } from "@netlify/blobs";
import { jsonResponse, loadJob } from "./_lib.mjs";

export default async function handler(request, context) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const jobId =
    (context && context.params && context.params.jobId) ||
    parts[parts.length - 1] ||
    url.searchParams.get("id");
  if (!jobId) {
    return jsonResponse({ error: "Job id required" }, 400);
  }

  const store = getStore({ name: "spellforge-jobs", consistency: "strong" });
  const job = await loadJob(store, jobId);
  if (!job) {
    return jsonResponse({ error: "Job not found" }, 404);
  }

  return jsonResponse({
    id: jobId,
    status: job.status,
    image: job.image,
    images: job.images,
    error: job.error,
    type: job.type,
  });
}