import fs from "fs";
import path from "path";

export const API_IMAGES = "https://api.x.ai/v1/images/generations";
export const API_RESPONSES = "https://api.x.ai/v1/responses";
export const TEXT_MODEL = "grok-4.20-0309-non-reasoning";
export const IMAGE_MODEL = "grok-imagine-image-quality";

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export const WOMBO_API = "https://api.luan.tools/api/tasks/";
export const WOMBO_STYLE_DEFAULT = 1;

export function getXaiKey() {
  return (process.env.XAI_API_KEY || process.env.XAI_API_KEYS || "").trim();
}

export function getWomboKey() {
  return (process.env.WOMBO_DREAM_API_KEY || process.env.DREAM_API_KEY || "").trim();
}

export function getImageProvider() {
  const forced = (process.env.SPELLFORGE_IMAGE_PROVIDER || "").trim().toLowerCase();
  const hasXai = !!getXaiKey();
  const hasWombo = !!getWomboKey();
  if (forced === "wombo") return hasWombo ? "wombo" : hasXai ? "xai" : "wombo";
  if (forced === "xai") return hasXai ? "xai" : hasWombo ? "wombo" : "xai";
  if (hasWombo && !hasXai) return "wombo";
  return "xai";
}

export function isImageApiConfigured() {
  return getImageProvider() === "wombo" ? !!getWomboKey() : !!getXaiKey();
}

export function getApiKey() {
  const key = getXaiKey();
  if (!key) {
    throw new Error(
      "XAI_API_KEY is not set. In Netlify: Site settings → Environment variables → add XAI_API_KEY, then redeploy."
    );
  }
  return key;
}

export function getImageApiKey() {
  if (getImageProvider() === "wombo") {
    const key = getWomboKey();
    if (!key) {
      throw new Error(
        "WOMBO_DREAM_API_KEY is not set. Get a key at https://api.dream.ai/signup — then add it on Netlify and redeploy."
      );
    }
    return key;
  }
  return getApiKey();
}

export function apiErrorMessage(data, status) {
  if (typeof data?.error === "string") return data.error;
  if (data?.error?.message) return data.error.message;
  if (data?.message) return data.message;
  return `HTTP ${status}`;
}

export function loadAnalyses() {
  const p = path.join(process.cwd(), "data", "analyses.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function extractResponseText(body) {
  for (const item of body.output || []) {
    if (item.type === "message") {
      for (const block of item.content || []) {
        if (block.type === "output_text" || block.type === "text") {
          return block.text || "";
        }
      }
    }
  }
  if (body.choices?.[0]?.message?.content) return body.choices[0].message.content;
  return "";
}

export function parseJsonBlob(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return JSON.parse(t);
}

/** xAI hard max on final prompt; stay a few under to avoid edge rejects. */
export const GEN_PROMPT_MAX_CHARS = 8000;
export const GEN_PROMPT_SAFE_MAX = 7992;
export const GEN_STASIS_BODY_MAX = 7200;

export function clipPromptChars(text, max = GEN_PROMPT_SAFE_MAX) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  let cut = t.slice(0, Math.max(0, max - 1));
  const nl = cut.lastIndexOf("\n");
  if (nl > max * 0.55) cut = cut.slice(0, nl);
  else {
    const sp = cut.lastIndexOf(" ");
    if (sp > max * 0.7) cut = cut.slice(0, sp);
  }
  return cut.replace(/\s+$/g, "") + "…";
}

export function buildStasisVisionPrompt(stasis, buzzWords) {
  const buzz =
    buzzWords?.length > 0
      ? buzzWords.slice(0, 16).join(", ")
      : "rich painterly detail";
  const prefix =
    "Create one original fine-art painting that embodies this fused vision. " +
    "Invent fresh imagery — not a photograph or collage of references.\n\n" +
    "STASIS (locked fusion — the scene, mood, and narrative to paint):\n";
  const suffix =
    `\n\nBUZZ WORDS (weave these into texture, motifs, palette accents, and micro-detail): ${buzz}\n\n` +
    "The image should read clearly at thumbnail scale yet reward close viewing. " +
    "Museum-quality, cohesive composition, expressive brushwork, 16:9 landscape.";
  const overhead = prefix.length + suffix.length;
  const bodyMax = Math.min(
    GEN_STASIS_BODY_MAX,
    Math.max(400, GEN_PROMPT_SAFE_MAX - overhead)
  );
  const body = clipPromptChars(String(stasis || "").trim(), bodyMax);
  return clipPromptChars(prefix + body + suffix, GEN_PROMPT_SAFE_MAX);
}

export async function saveJob(store, jobId, data) {
  await store.setJSON(jobId, { ...data, updated_at: Date.now() });
}

export async function loadJob(store, jobId) {
  return store.get(jobId, { type: "json" });
}

function womboHeaders(token, json = true) {
  const h = {
    Origin: "https://dream.ai",
    Referer: "https://dream.ai/",
    Authorization: "bearer " + token,
    service: "Dream",
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export function truncateWomboPrompt(text, max = 100) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

export function buildWomboPrompt(stasis, buzzWords) {
  let base = (stasis || "").replace(/\s+/g, " ").trim();
  if (base.length > 72) base = base.slice(0, 72);
  const buzz = (buzzWords || []).slice(0, 6).join(", ");
  const prompt = buzz ? `${base}, ${buzz}` : base;
  return truncateWomboPrompt(prompt, 100);
}

function extractWomboImageUrl(task) {
  const r = task?.result || task;
  const gens = r?.final_generations || r?.generations || [];
  for (let i = 0; i < gens.length; i++) {
    const g = gens[i];
    if (g?.url) return g.url;
    if (g?.image_url) return g.image_url;
    if (g?.jpg) return g.jpg;
  }
  if (r?.image_url) return r.image_url;
  if (task?.image_url) return task.image_url;
  throw new Error("No image URL in WOMBO Dream response.");
}

export async function generateWomboStasisImage(stasis, buzzWords) {
  const token = getImageApiKey();
  const prompt = buildWomboPrompt(stasis, buzzWords);
  const styleId = parseInt(process.env.WOMBO_STYLE_ID || String(WOMBO_STYLE_DEFAULT), 10) || 1;
  const width = parseInt(process.env.WOMBO_WIDTH || "1280", 10) || 1280;
  const height = parseInt(process.env.WOMBO_HEIGHT || "720", 10) || 720;

  const createResp = await fetch(WOMBO_API, {
    method: "POST",
    headers: womboHeaders(token),
    body: JSON.stringify({ use_target_image: false }),
  });
  const createData = await createResp.json();
  if (!createResp.ok) {
    throw new Error(apiErrorMessage(createData, createResp.status));
  }

  const taskId = createData.id;
  if (!taskId) throw new Error("WOMBO did not return a task id.");

  const putResp = await fetch(WOMBO_API + taskId, {
    method: "PUT",
    headers: womboHeaders(token),
    body: JSON.stringify({
      input_spec: {
        style: styleId,
        prompt,
        target_image_weight: 0.5,
        width,
        height,
      },
    }),
  });
  const putData = await putResp.json();
  if (!putResp.ok) {
    throw new Error(apiErrorMessage(putData, putResp.status));
  }

  let task = putData;
  let pollDelay = 750;
  for (let i = 0; i < 120; i++) {
    if (task.state === "completed") {
      return extractWomboImageUrl(task);
    }
    if (task.state === "failed") {
      throw new Error(task.error || task.message || "WOMBO Dream generation failed.");
    }
    await new Promise((r) => setTimeout(r, pollDelay));
    pollDelay = Math.min(2000, pollDelay + 150);
    const pollResp = await fetch(WOMBO_API + taskId, { headers: womboHeaders(token) });
    task = await pollResp.json();
    if (!pollResp.ok) {
      throw new Error(apiErrorMessage(task, pollResp.status));
    }
  }
  throw new Error("WOMBO Dream timed out (3 minutes).");
}

export async function generateXaiStasisImage(stasis, buzzWords) {
  const apiKey = getImageApiKey();
  const fullPrompt = buildStasisVisionPrompt(stasis, buzzWords);

  const resp = await fetch(API_IMAGES, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: fullPrompt,
      n: 1,
      aspect_ratio: "16:9",
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(apiErrorMessage(data, resp.status));
  }

  const items = data.data || [];
  if (!items.length) throw new Error("No image returned from xAI.");

  const item = items[0];
  if (item.b64_json) return `data:image/jpeg;base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error("No image data in xAI response.");
}

export async function generateStasisVisionImage(stasis, buzzWords) {
  if (getImageProvider() === "wombo") {
    return generateWomboStasisImage(stasis, buzzWords);
  }
  return generateXaiStasisImage(stasis, buzzWords);
}