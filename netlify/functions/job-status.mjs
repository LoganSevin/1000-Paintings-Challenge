import { getStore } from "@netlify/blobs";
import { jsonResponse, loadJob, visitorXaiKey } from "./_lib.mjs";
import { refreshAnimateJob } from "./animate-cast.mjs";

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
  let job = await loadJob(store, jobId);
  if (!job) {
    return jsonResponse({ error: "Job not found" }, 404);
  }
  if (job.type === "animate") {
    job = await refreshAnimateJob(store, job, visitorXaiKey(request));
  }

  const created = Number(job.created_at) || 0;
  const elapsed = created ? Math.max(0, Math.round((Date.now() - created) / 1000)) : null;
  return jsonResponse({
    id: jobId,
    status: job.status,
    image: job.image,
    images: job.images,
    video: job.video || null,
    error: job.error,
    type: job.type,
    xai_status: job.xai_status || "",
    elapsed_sec: elapsed,
    moderated: !!job.moderated,
    prompt: job.moderated ? String(job.prompt || "") : "",
    dropped: job.moderated && Array.isArray(job.dropped) ? job.dropped : [],
  });
}
