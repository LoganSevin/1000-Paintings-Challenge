import {
  corsPreflight,
  jsonResponse,
  isCreditsLimitError,
  listVideoKeys,
  visitorXaiKey,
  withVideoAuth,
} from "./_lib.mjs";

const VIDEO_START = "https://api.x.ai/v1/videos/generations";
const SCRIPT =
  "A newly generated head-and-shoulders portrait of the person in <IMAGE_0>, with their face, age, hair, skin, and clothes. Quiet room, fixed camera, one continuous take. " +
  "They face the camera and speak in the voice of <AUDIO_0>, clearly, one number at a time: \"1, 2, 3, 4, 5, 6.\" " +
  "Then their head turns until they are looking toward the left side of the frame. " +
  "Then their head turns until they are looking toward the right side of the frame. " +
  "Then their head turns until they are looking toward the left side of the frame again. " +
  "Then they face the camera and hold. The spoken words are only those six numbers. The three looks are silent.";

function noKey() {
  return jsonResponse({ error: "Cloud cameo is not available." }, 503);
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

async function startCameo(image, visitorKey) {
  return withVideoAuth(async function (key) {
    const res = await fetch(VIDEO_START, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-imagine-video-1.5",
        prompt: SCRIPT,
        reference_images: [{ url: image }],
        reference_audios: [{ voice_id: "eve" }],
        duration: 15,
        aspect_ratio: "9:16",
        resolution: "720p",
      }),
    });
    if (!res.ok) throw await errorFrom(res);
    const data = await res.json();
    if (!data || !data.request_id) throw new Error("Video service did not start a job.");
    return data.request_id;
  }, visitorKey);
}

async function pollCameo(id, visitorKey) {
  const keys = await listVideoKeys(visitorKey);
  if (!keys.length) return noKey();
  let lastStatus = 404;
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch("https://api.x.ai/v1/videos/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + keys[i] },
    });
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      lastStatus = res.status;
      continue;
    }
    if (!res.ok) {
      const err = await errorFrom(res);
      return jsonResponse({ status: "failed", error: { message: err.message } }, res.status);
    }
    const data = await res.json();
    return jsonResponse({
      id: id,
      status: String((data && data.status) || "pending").toLowerCase(),
      video: (data && data.video) || null,
      error: (data && data.error) || null,
    });
  }
  return jsonResponse({ error: "Cameo job not found." }, lastStatus === 401 ? 401 : 404);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const visitor = visitorXaiKey(request);
  if (request.method === "GET") {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[\w-]{8,200}$/.test(id)) return jsonResponse({ error: "Job id required." }, 400);
    return pollCameo(id, visitor);
  }

  if (request.method !== "POST") return jsonResponse({ error: "POST required." }, 405);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON." }, 400);
  }
  const image = String((body && body.reference_image) || "").trim();
  if (!image.startsWith("data:image/")) {
    return jsonResponse({ error: "Upload an image first." }, 400);
  }
  if (image.length > 4500000) {
    return jsonResponse({ error: "That image is too large. Try a smaller one." }, 413);
  }

  try {
    const jobId = await startCameo(image, visitor);
    return jsonResponse({ ok: true, job_id: jobId, status: "pending" }, 202);
  } catch (e) {
    let msg = (e && e.message) || "Cameo could not start.";
    if (isCreditsLimitError(e)) {
      msg =
        "The console API key is out of credits. This cameo uses the Grok login, and that login did not start the video.";
    }
    return jsonResponse({ error: msg }, 500);
  }
}
