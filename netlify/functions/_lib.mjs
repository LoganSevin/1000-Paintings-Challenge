import fs from "fs";
import path from "path";
import { AsyncLocalStorage } from "node:async_hooks";

const xaiKeyStore = new AsyncLocalStorage();

export function visitorXaiKey(request) {
  if (!request || !request.headers) return "";
  const raw =
    request.headers.get("x-visitor-xai-key") ||
    request.headers.get("X-Visitor-Xai-Key") ||
    "";
  return String(raw).replace(/^Bearer\s+/i, "").trim();
}

export function runWithXaiKey(key, fn) {
  return xaiKeyStore.run(String(key || "").trim(), fn);
}

export const API_IMAGES = "https://api.x.ai/v1/images/generations";
export const API_IMAGE_EDITS = "https://api.x.ai/v1/images/edits";
export const API_RESPONSES = "https://api.x.ai/v1/responses";
export const TEXT_MODEL = "grok-4.20-0309-non-reasoning";
export const IMAGE_MODEL = "grok-imagine-image-quality";

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Visitor-Xai-Key",
    },
  });
}

export function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Visitor-Xai-Key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

export const WOMBO_API = "https://api.luan.tools/api/tasks/";
export const WOMBO_STYLE_DEFAULT = 1;

export function isCreditsLimitError(err) {
  const m = String(err && err.message ? err.message : err || "").toLowerCase();
  return (
    m.includes("credit") ||
    m.includes("spending limit") ||
    m.includes("monthly spending") ||
    m.includes("purchase more")
  );
}

export function listXaiKeys(extra) {
  const keys = [];
  const seen = new Set();
  function add(raw) {
    const key = String(raw || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  }
  add(extra);
  add(xaiKeyStore.getStore());
  String(process.env.XAI_API_KEY || "")
    .split(/[\n\r,;]+/)
    .forEach(add);
  String(process.env.XAI_API_KEYS || "")
    .split(/[\n\r,;]+/)
    .forEach(add);
  return keys;
}

export function getXaiKey() {
  return listXaiKeys()[0] || "";
}

export function getWomboKey() {
  return (process.env.WOMBO_DREAM_API_KEY || process.env.DREAM_API_KEY || "").trim();
}

/**
 * Free Cloudflare Workers AI image fallback (used when xAI fails or has no key).
 * Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (Workers AI Read + Edit).
 * CF_IMAGE_MODEL is optional (default flux-1-schnell; SDXL also supported).
 */
export const CF_DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
export const CF_PROMPT_MAX = 2000;

export function getCfCreds() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
  return accountId && token ? { accountId, token } : null;
}

export function getCfImageModel() {
  return String(process.env.CF_IMAGE_MODEL || "").trim() || CF_DEFAULT_IMAGE_MODEL;
}

export function getImageProvider() {
  const forced = (process.env.SPELLFORGE_IMAGE_PROVIDER || "").trim().toLowerCase();
  const hasXai = !!getXaiKey();
  const hasWombo = !!getWomboKey();
  const hasCf = !!getCfCreds();
  if (forced === "cloudflare" && hasCf) return "cloudflare";
  if (forced === "wombo") return hasWombo ? "wombo" : hasXai ? "xai" : hasCf ? "cloudflare" : "wombo";
  if (forced === "xai") return hasXai ? "xai" : hasCf ? "cloudflare" : hasWombo ? "wombo" : "xai";
  if (!hasXai && hasCf) return "cloudflare";
  if (hasWombo && !hasXai) return "wombo";
  return "xai";
}

export function isImageApiConfigured() {
  const provider = getImageProvider();
  if (provider === "cloudflare") return true;
  return provider === "wombo" ? !!getWomboKey() : !!getXaiKey();
}

export function getApiKey() {
  const key = listXaiKeys()[0];
  if (!key) {
    throw new Error(
      "No xAI API key. Connect a key from console.x.ai, or add XAI_API_KEY on Netlify."
    );
  }
  return key;
}

/** xAI rejected the key itself (wrong/revoked/placeholder), as opposed to a billing limit. */
export function isInvalidKeyError(err) {
  const m = String(err && err.message ? err.message : err || "").toLowerCase();
  return (
    m.includes("incorrect api key") ||
    m.includes("invalid api key") ||
    m.includes("api key is invalid") ||
    m.includes("invalid authentication") ||
    m.includes("no api key provided") ||
    /\bunauthori[sz]ed\b/.test(m)
  );
}

export const VISITOR_KEY_REJECTED = "Your saved xAI key was rejected by xAI";

/**
 * Try keys in order (visitor key first, then XAI_API_KEY / XAI_API_KEYS).
 * Moves on to the next key when a key is out of credits OR rejected as invalid,
 * so a stale/wrong visitor key no longer blocks the site key. Any other error
 * stops immediately. If the visitor key was rejected and nothing else worked,
 * the error says so (prefix VISITOR_KEY_REJECTED) so the page can ask to reconnect.
 */
export async function withXaiKeyFallback(fn, extraKey) {
  const keys = listXaiKeys(extraKey);
  if (!keys.length) {
    throw new Error(
      "No xAI API key. Connect a key from console.x.ai to keep generating."
    );
  }
  const visitorKeys = new Set(
    [extraKey, xaiKeyStore.getStore()]
      .map((k) => String(k || "").trim())
      .filter(Boolean)
  );
  let lastErr;
  let visitorRejected = null;
  function finalError(err) {
    if (!visitorRejected) return err;
    const why = visitorRejected.message || String(visitorRejected);
    if (err === visitorRejected) {
      return new Error(
        `${VISITOR_KEY_REJECTED} (${why}). Reconnect a valid key from console.x.ai.`
      );
    }
    return new Error(
      `${VISITOR_KEY_REJECTED} (${why}). The site's backup key also failed: ${
        (err && err.message) || String(err)
      }`
    );
  }
  for (let i = 0; i < keys.length; i++) {
    try {
      return await runWithXaiKey(keys[i], function () {
        return fn(keys[i]);
      });
    } catch (err) {
      lastErr = err;
      const invalid = isInvalidKeyError(err);
      if (invalid && !visitorRejected && visitorKeys.has(keys[i])) visitorRejected = err;
      if (!invalid && !isCreditsLimitError(err)) throw finalError(err);
    }
  }
  throw finalError(lastErr);
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

export const ALLOWED_ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];

export function normalizeAspect(value, fallback = "16:9") {
  const v = String(value || "")
    .trim()
    .replace("/", ":")
    .replace(/\s+/g, "");
  return ALLOWED_ASPECTS.includes(v) ? v : fallback;
}

export function aspectPhrase(aspect) {
  const a = normalizeAspect(aspect);
  const [w, h] = a.split(":").map(Number);
  const orient = w === h ? "square" : w > h ? "landscape" : "portrait";
  return `${a} ${orient}`;
}

export function aspectToSize(aspect, longSide = 1280) {
  const a = normalizeAspect(aspect);
  const [aw, ah] = a.split(":").map(Number);
  if (aw >= ah) {
    return { width: longSide, height: Math.max(1, Math.round((longSide * ah) / aw)) };
  }
  return { width: Math.max(1, Math.round((longSide * aw) / ah)), height: longSide };
}

export function buildStasisVisionPrompt(stasis, buzzWords, aspectRatio) {
  const buzz =
    buzzWords?.length > 0
      ? buzzWords.slice(0, 16).join(", ")
      : "rich painterly detail";
  const frame = aspectPhrase(aspectRatio);
  const prefix =
    "Create one original fine-art painting that embodies this fused vision. " +
    "Invent fresh imagery — not a photograph or collage of references.\n\n" +
    "STASIS (locked fusion — the scene, mood, and narrative to paint):\n";
  const suffix =
    `\n\nBUZZ WORDS (weave these into texture, motifs, palette accents, and micro-detail): ${buzz}\n\n` +
    "The image should read clearly at thumbnail scale yet reward close viewing. " +
    `Museum-quality, cohesive composition, expressive brushwork. Compose for a ${frame} frame and fill the entire canvas.`;
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

export async function generateWomboStasisImage(stasis, buzzWords, aspectRatio) {
  const token = getWomboKey();
  if (!token) {
    throw new Error("WOMBO_DREAM_API_KEY is not set.");
  }
  const prompt = buildWomboPrompt(stasis, buzzWords);
  const styleId = parseInt(process.env.WOMBO_STYLE_ID || String(WOMBO_STYLE_DEFAULT), 10) || 1;
  const sized = aspectToSize(aspectRatio, 1280);
  const width = sized.width;
  const height = sized.height;

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

export async function materializeStillDataUrl(imageUrl) {
  const url = String(imageUrl || "").trim();
  if (!url) return url;
  if (url.startsWith("data:")) return url;
  const resp = await fetch(url);
  if (!resp.ok) return url;
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 32) return url;
  let mime = String(resp.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim();
  if (!mime.startsWith("image/")) {
    if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
    else if (buf[0] === 0x89) mime = "image/png";
    else mime = "image/jpeg";
  }
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function xaiImageFromResponse(data) {
  const items = data.data || [];
  if (!items.length) throw new Error("No image returned from xAI.");
  const item = items[0];
  if (item.b64_json) return `data:image/jpeg;base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error("No image data in xAI response.");
}

export function buildFlashProjectPrompt(stasis, buzzWords, aspectRatio) {
  const buzz =
    buzzWords?.length > 0
      ? buzzWords.slice(0, 16).join(", ")
      : "rich painterly detail";
  const frame = aspectPhrase(aspectRatio);
  const prefix =
    "Paint one NEW original fine-art still inspired by the attached overhead-projector composition. " +
    "This must be a finished museum painting, not a photograph of acetate, glass, or the source collage. " +
    "Keep the same subjects, spatial arrangement, and mood, but invent fresh brushwork and lighting.\n\n" +
    "STASIS (scene to paint):\n";
  const suffix =
    `\n\nBUZZ WORDS: ${buzz}\n\n` +
    `Museum-quality, cohesive composition, expressive brushwork. Compose for a ${frame} frame and fill the entire canvas.`;
  const overhead = prefix.length + suffix.length;
  const bodyMax = Math.min(
    GEN_STASIS_BODY_MAX,
    Math.max(400, GEN_PROMPT_SAFE_MAX - overhead)
  );
  const body = clipPromptChars(String(stasis || "").trim(), bodyMax);
  return clipPromptChars(prefix + body + suffix, GEN_PROMPT_SAFE_MAX);
}

async function postXaiImage(url, payload, apiKey) {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(apiErrorMessage(data, resp.status));
  }
  return xaiImageFromResponse(data);
}

export async function generateXaiStasisImage(stasis, buzzWords, aspectRatio, referenceImage) {
  return withXaiKeyFallback(async function (apiKey) {
    const aspect = normalizeAspect(aspectRatio);
    const ref = String(referenceImage || "").trim();
    const fullPrompt = ref
      ? buildFlashProjectPrompt(stasis, buzzWords, aspect)
      : buildStasisVisionPrompt(stasis, buzzWords, aspect);
    const base = {
      model: IMAGE_MODEL,
      prompt: fullPrompt,
      n: 1,
      aspect_ratio: aspect,
    };
    if (ref) {
      try {
        return await postXaiImage(
          API_IMAGE_EDITS,
          {
            ...base,
            image: { url: ref, type: "image_url" },
          },
          apiKey
        );
      } catch (errEdits) {
        try {
          return await postXaiImage(
            API_IMAGES,
            { ...base, image_url: ref },
            apiKey
          );
        } catch (errGen) {
          throw errEdits;
        }
      }
    }
    return postXaiImage(API_IMAGES, base, apiKey);
  });
}

/** Prompt for Cloudflare models: same painting prompt, stasis trimmed so the whole thing fits CF_PROMPT_MAX. */
export function buildCloudflarePrompt(stasis, buzzWords, aspect) {
  const overhead = buildStasisVisionPrompt("", buzzWords, aspect).length + 2;
  const body = clipPromptChars(String(stasis || "").trim(), Math.max(200, CF_PROMPT_MAX - overhead));
  return clipPromptChars(buildStasisVisionPrompt(body, buzzWords, aspect), CF_PROMPT_MAX);
}

/** Text-to-image via Cloudflare Workers AI REST. Reference images are ignored. Returns a data: URL. */
export async function generateCloudflareStasisImage(stasis, buzzWords, aspectRatio) {
  const creds = getCfCreds();
  if (!creds) {
    throw new Error(
      "Cloudflare Workers AI is not configured (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)."
    );
  }
  const model = getCfImageModel();
  const aspect = normalizeAspect(aspectRatio);
  const payload = { prompt: buildCloudflarePrompt(stasis, buzzWords, aspect) };
  const isSdxl = /stable-diffusion-xl/i.test(model);
  if (isSdxl) {
    const sized = aspectToSize(aspect, 1024);
    payload.width = Math.max(256, Math.floor(sized.width / 8) * 8);
    payload.height = Math.max(256, Math.floor(sized.height / 8) * 8);
  } else if (/flux-1-schnell/i.test(model)) {
    payload.steps = 4;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    creds.accountId
  )}/ai/run/${model}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const type = String(resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (resp.ok && type.startsWith("image/")) {
    // SDXL (and other binary models) return raw image bytes, usually PNG.
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 32) throw new Error("Cloudflare Workers AI returned an empty image.");
    return `data:${type};base64,${buf.toString("base64")}`;
  }
  const data = await resp.json().catch(function () {
    return {};
  });
  if (!resp.ok || data.success === false) {
    const msg = (data.errors && data.errors[0] && data.errors[0].message) || `HTTP ${resp.status}`;
    throw new Error(`Cloudflare Workers AI: ${msg}`);
  }
  const image = data.result && data.result.image;
  if (!image) throw new Error("Cloudflare Workers AI returned no image.");
  return String(image).startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;
}

/** xAI failures that should hand off to the free Cloudflare fallback. */
export function shouldUseCloudflareFallback(err) {
  const m = String(err && err.message ? err.message : err || "").toLowerCase();
  return (
    isCreditsLimitError(err) ||
    isInvalidKeyError(err) ||
    m.includes("no xai api key") ||
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("quota")
  );
}

export async function generateStasisVisionImage(stasis, buzzWords, aspectRatio, referenceImage) {
  const provider = getImageProvider();
  if (provider === "cloudflare") {
    return generateCloudflareStasisImage(stasis, buzzWords, aspectRatio);
  }
  if (provider === "wombo") {
    return generateWomboStasisImage(stasis, buzzWords, aspectRatio);
  }
  try {
    return await generateXaiStasisImage(stasis, buzzWords, aspectRatio, referenceImage);
  } catch (err) {
    if (getCfCreds() && shouldUseCloudflareFallback(err)) {
      try {
        return await generateCloudflareStasisImage(stasis, buzzWords, aspectRatio);
      } catch (cfErr) {
        if (isCreditsLimitError(err) && getWomboKey()) {
          return generateWomboStasisImage(stasis, buzzWords, aspectRatio);
        }
        throw new Error(
          `${(err && err.message) || String(err)} (Free Cloudflare fallback also failed: ${
            (cfErr && cfErr.message) || String(cfErr)
          })`
        );
      }
    }
    if (isCreditsLimitError(err) && getWomboKey()) {
      return generateWomboStasisImage(stasis, buzzWords, aspectRatio);
    }
    throw err;
  }
}