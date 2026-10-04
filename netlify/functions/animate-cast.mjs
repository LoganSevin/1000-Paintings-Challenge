import { getStore } from "@netlify/blobs";
import {
  corsPreflight,
  jsonResponse,
  isCreditsLimitError,
  listVideoKeys,
  saveJob,
  visitorXaiKey,
  withVideoAuth,
} from "./_lib.mjs";

const VIDEO_START = "https://api.x.ai/v1/videos/generations";
const VIDEO_MODEL = "grok-imagine-video-1.5";
const ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];
const STILL_MOTION =
  "Animate this still. Preserve the subjects, palette, and composition. Gentle living motion, fixed camera.";

function clipPrompt(text) {
  let s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length > 3500) s = s.slice(0, 3499).trim() + "…";
  return s;
}

function pickDuration(value) {
  const n = parseInt(value, 10);
  if (n === 6 || n === 10 || n === 15) return n;
  if (n >= 13) return 15;
  if (n >= 8) return 10;
  return 6;
}

function pickResolution(value) {
  return String(value || "").toLowerCase() === "480p" ? "480p" : "720p";
}

function pickAspect(value) {
  const aspect = String(value || "16:9");
  return ASPECTS.indexOf(aspect) >= 0 ? aspect : "16:9";
}

function stillUrl(body) {
  return String(
    (body && (body.reference_image || body.image_url || body.spell_reference_image)) || ""
  ).trim();
}

export function buildAnimateRequest(body) {
  body = body || {};
  const image = stillUrl(body);
  let prompt = String(body.image_to_life_prompt || body.prompt || "").trim();
  const stasis = String(body.stasis || "").trim();
  if (stasis && stasis !== prompt && prompt.indexOf(stasis) < 0) {
    prompt = (prompt ? prompt + " " : "") + stasis;
  }
  prompt = clipPrompt(prompt);
  if (!prompt && image) prompt = STILL_MOTION;
  const payload = {
    model: VIDEO_MODEL,
    prompt: prompt,
    duration: pickDuration(body.duration),
    aspect_ratio: pickAspect(body.aspect_ratio),
    resolution: pickResolution(body.resolution),
  };
  if (image) payload.image = { url: image };
  return payload;
}

function mapVideoStatus(raw) {
  const status = String(raw || "").toLowerCase();
  if (status === "completed" || status === "succeeded" || status === "success") return "done";
  if (status === "error") return "failed";
  return status || "pending";
}

async function errorFrom(res) {
  let msg = "Video request failed (" + res.status + ").";
  try {
    const data = await res.json();
    const raw = data && (data.error || data.message);
    if (typeof raw === "string" && raw) msg = raw;
    else if (raw && raw.message) msg = raw.message;
  } catch (e) {}
  const err = new Error(msg);
  err.status = res.status;
  return err;
}

export async function refreshAnimateJob(store, job, visitorKey) {
  if (!job || job.type !== "animate") return job;
  const current = String(job.status || "");
  if (current === "done" || current === "failed" || current === "expired") return job;
  const id = String(job.request_id || job.id || "");
  if (!id) return job;
  const keys = await listVideoKeys(visitorKey);
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch("https://api.x.ai/v1/videos/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + keys[i] },
    });
    if (res.status === 404 || res.status === 401 || res.status === 403) continue;
    if (!res.ok) continue;
    const data = await res.json();
    const status = mapVideoStatus(data && data.status);
    const next = {
      ...job,
      id: id,
      type: "animate",
      status: status,
      xai_status: String((data && data.status) || ""),
      video: (data && data.video) || job.video || null,
      error: (data && data.error) || null,
      created_at: job.created_at || Date.now(),
    };
    if ((status === "failed" || status === "expired") && !next.error) {
      next.error = { message: "Video generation failed." };
    }
    if (store) await saveJob(store, id, next);
    return next;
  }
  return job;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON." }, 400);
  }

  const payload = buildAnimateRequest(body);
  const image = payload.image && payload.image.url;
  if (!payload.prompt) {
    return jsonResponse({ error: "Add a scene prompt, or send a still to animate." }, 400);
  }
  if (image) {
    const remote = /^https?:\/\//i.test(image);
    const dataImage = image.startsWith("data:image/");
    if (!remote && !dataImage) {
      return jsonResponse({ error: "The still must be an image link or an uploaded image." }, 400);
    }
    if (dataImage && image.length > 4500000) {
      return jsonResponse({ error: "That still is too large. Try a smaller image." }, 413);
    }
  }

  const visitor = visitorXaiKey(request);
  try {
    const requestId = await withVideoAuth(async function (key) {
      const res = await fetch(VIDEO_START, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await errorFrom(res);
      const data = await res.json();
      if (!data || !data.request_id) throw new Error("Video service did not start a job.");
      return data.request_id;
    }, visitor);

    const store = getStore({ name: "spellforge-jobs", consistency: "strong" });
    await saveJob(store, requestId, {
      id: requestId,
      type: "animate",
      status: "pending",
      request_id: requestId,
      created_at: Date.now(),
    });
    return jsonResponse({ job_id: requestId, status: "pending" }, 202);
  } catch (e) {
    let msg = (e && e.message) || "Animate could not start.";
    if (isCreditsLimitError(e)) {
      msg =
        "The console API key is out of credits. This cast uses the Grok login, and that login did not start the video.";
    }
    return jsonResponse({ error: msg }, 500);
  }
}
