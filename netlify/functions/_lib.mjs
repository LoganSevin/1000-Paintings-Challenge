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

/** flux-1-schnell diffusion steps (Cloudflare max 8). CF_IMAGE_STEPS overrides. */
export const CF_FLUX_STEPS_DEFAULT = 4;
export function getCfFluxSteps() {
  const n = parseInt(String(process.env.CF_IMAGE_STEPS || ""), 10);
  return n >= 1 && n <= 8 ? n : CF_FLUX_STEPS_DEFAULT;
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

/*
 * FLUX-friendly prompt for the Cloudflare fallback.
 * FLUX schnell reads a short plain description best (its text encoder only takes the first
 * ~256 tokens, and the opening words weigh most). The long xAI stasis prompt led with
 * meta-instructions ("NOT a remake… Do not preserve…") and, once clipped, lost Influence II/III
 * entirely. So: subject first in plain words, then medium/palette/mood/framing, one short
 * "no text" tail. The xAI prompt path does not use this.
 */
export const FLUX_PROMPT_TARGET = 1100;
const FLUX_META_RE =
  /\b(remake|restage|near-copy|collage|triptych|letterbox\w*|product-ready|for sale|motif dna|influence texts?|fusion directive|studio author|thumbnail|museum-quality|fill the (entire )?canvas|brand[- ]new|never existed|override|mandatory|repaint|seeded from|entire brief|invent it freely)\b/i;
const FLUX_NEGATIVE_START_RE = /^(no|never|do not|don't|avoid|without|introduce no)\b/i;
const FLUX_BUZZ_SKIP_RE =
  /^(original painting|brand new composition|invented scene|painting|art|artwork|three-tone palette|limited palette)$/i;
const FLUX_NON_PAINT_STYLE_RE = /\b(cgi|3d|render|photo\w*|digital|pixel|vector)\b/i;
const FLUX_MEDIUM_RE =
  /\b(oil|acrylic|watercolou?r|gouache|ink|pencil|charcoal|pastel|line[- ]art|sketch|fresco|tempera|woodcut|linocut|mosaic|photograph\w*|3d)\b/i;

function fluxSentences(text) {
  return String(text || "")
    .replace(/\s*\(#[0-9a-f]{3,8}\)/gi, "") // "Crimson Red (#C81D25)" -> "Crimson Red" (FLUX can't read hex)
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+(?=[A-Z0-9"“(«])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** "The painting portrays stylized figures…" -> "Stylized figures…" */
function fluxPlainLead(sentence) {
  const t = String(sentence || "").replace(
    /^(the|this|a|an)\s+(painting|image|artwork|piece|work|scene|composition|picture|illustration|render(ing)?)\s+(portrays|depicts|shows|features|presents|captures|illustrates|is of)\s+/i,
    ""
  );
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Leading whole sentences of `text` within `budget` chars; the first sentence is always kept whole. */
function fluxLeadSentences(text, budget) {
  const out = [];
  let len = 0;
  for (const raw of fluxSentences(text)) {
    const sent = fluxPlainLead(raw);
    if (out.length && len + 1 + sent.length > budget) break;
    out.push(sent);
    len += (out.length > 1 ? 1 : 0) + sent.length;
  }
  return out.join(" ");
}

function fluxDescFromSlotBody(body) {
  const paras = String(body || "")
    .split(/\n\s*\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  let title = "";
  const desc = [];
  for (let i = 0; i < paras.length; i++) {
    const para = paras[i];
    if (/^(style|tags|generation prompt|source \(verbatim\))\s*:/i.test(para)) continue;
    if (/^(generated still|phone upload|line sketch|inverted sketch)\b/i.test(para)) continue;
    if (/^\(description pending/i.test(para)) continue;
    if (i === 0 && !title && para.length <= 80 && !/[.!?]$/.test(para) && paras.length > 1) {
      title = para;
      continue;
    }
    desc.push(para);
  }
  return { title, desc: desc.join(" ") || title };
}

function fluxColorNames(text) {
  const names = [];
  const t = String(text || "");
  const add = (n) => {
    const v = String(n || "").replace(/\s+/g, " ").trim();
    if (v && v.length <= 40 && !names.some((x) => x.toLowerCase() === v.toLowerCase())) names.push(v);
  };
  let m;
  const labeled = /([A-Z][A-Za-z' -]{1,38}?)\s*\(#[0-9a-f]{3,8}\)/gi; // "Crimson Red (#C81D25)"
  while ((m = labeled.exec(t))) add(m[1].replace(/^.*[•:;]\s*/, ""));
  const toned = /#[0-9a-f]{3,8}\s*[—-]\s*([A-Za-z][A-Za-z' -]{1,38}?)\s*(?:\(|$|\n)/gim; // "#0E5E6F — Deep Teal ("
  while ((m = toned.exec(t))) add(m[1]);
  return names.slice(0, 6);
}

function fluxFraming(aspect) {
  const a = normalizeAspect(aspect);
  const [w, h] = a.split(":").map(Number);
  if (w === h) return "Square composition that fills the frame.";
  return w > h
    ? "Wide landscape composition that fills the frame."
    : "Tall portrait composition that fills the frame.";
}

/** Spellforge auto-built stasis -> { subjects[], colors[], styles[], moods[], extra } or null. */
function parseSpellforgeStasis(stasis) {
  const text = String(stasis || "");
  if (!/SPELLFORGE PRODUCT|──\s*INFLUENCE\s+[IV]+/.test(text)) return null;
  const subjects = [];
  const re = /──\s*INFLUENCE\s+[IV]+[^\n]*──\s*\n([\s\S]*?)(?=\n\s*──\s*INFLUENCE|\n\s*FUSION DIRECTIVE|\n\s*Style DNA|\n\s*Buzz words:|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const d = fluxDescFromSlotBody(m[1]);
    if (d.desc && d.desc !== "(no description)") subjects.push(d);
  }
  const line = (label) => {
    const r = new RegExp("^" + label + "[^:\\n]*:[ \\t]*([^\\n]+)", "m").exec(text);
    return r ? r[1].replace(/[.…]+$/, "").trim() : "";
  };
  const locksBlock = (/(MANDATORY[^\n]*\n?(?:\s*•[^\n]*\n?)*)/.exec(text) || [""])[0];
  return {
    subjects,
    colors: fluxColorNames(locksBlock),
    styles: line("Style DNA").split(/,\s*/).filter(Boolean),
    moods: line("Mood DNA").split(/\s*\+\s*/).filter(Boolean),
    extra: line("Extra direction"),
  };
}

/** Any other page's stasis (Colors, 0-Z, edited 4th description…): keep content, drop meta/negatives. */
function parseGenericStasis(stasis) {
  const raw = String(stasis || "");
  const colors = fluxColorNames(raw);
  const lines = raw.split(/\n+/).filter((l) => !/^\s*[•*-]\s/.test(l)); // bullet spec lines -> palette only
  const kept = [];
  const subjectFirst = [];
  for (const sent of fluxSentences(lines.join("\n"))) {
    let t = sent.replace(/^[A-Z0-9 '’&-]{6,}\s*[—:-]\s*/, ""); // drop "THREE-TONE PAINTING — " style headings
    if (!t || FLUX_META_RE.test(t) || FLUX_NEGATIVE_START_RE.test(t)) continue;
    if (/^subject\s*:/i.test(t)) {
      t = t.replace(/^subject\s*:\s*(anything at all\s*[—-]\s*this time,\s*)?/i, "");
      subjectFirst.push(t.charAt(0).toUpperCase() + t.slice(1));
      continue;
    }
    kept.push(fluxPlainLead(t));
  }
  return { text: subjectFirst.concat(kept).join(" "), colors };
}

/** Words that end a trimmed clause badly ("…a fox with" -> "…a fox"). */
const FLUX_DANGLING_RE = /[\s,;:—–]+(and|or|with|while|of|in|on|at|to|by|for|from|the|a|an|its|their|as|that|which)?\s*$/i;

/** Core subject + key visual elements of one spell, bounded to `cap` chars (clause, then word boundary). */
function fluxSpellCore(desc, cap) {
  const sents = fluxSentences(desc)
    .filter((s) => !FLUX_META_RE.test(s) && !FLUX_NEGATIVE_START_RE.test(s))
    .map(fluxPlainLead);
  let out = "";
  for (const s of sents) {
    if (!out) out = s;
    else if (out.length + 1 + s.length <= cap) out += " " + s;
    else break;
  }
  if (out.length > cap) {
    const head = out.slice(0, cap + 1);
    let cut = -1;
    for (const b of [". ", "; ", ", ", " — ", " – ", ": ", " while ", " with ", " and "]) {
      const i = head.lastIndexOf(b);
      if (i >= cap * 0.5 && i > cut) cut = i;
    }
    if (cut < 0) cut = head.lastIndexOf(" ");
    out = out.slice(0, cut > 0 ? cut : cap);
    let prev;
    do {
      prev = out;
      out = out.replace(FLUX_DANGLING_RE, "");
    } while (out !== prev);
  }
  return out.replace(/[\s.…,;:]+$/, "").trim();
}

/** The user's own extra buzz words, verbatim (whitespace collapsed, trailing period dropped). */
function fluxExtraBuzz(v) {
  const raw = Array.isArray(v)
    ? v.map((x) => String(x || "").trim()).filter(Boolean).join(", ")
    : typeof v === "string"
      ? v
      : "";
  const t = raw.replace(/\s+/g, " ").replace(/[\s.…]+$/, "").trim();
  return t.length > FLUX_EXTRA_MAX ? clipPromptChars(t, FLUX_EXTRA_MAX).replace(/…$/, "") : t;
}

const FLUX_EXTRA_MAX = 800;
const FLUX_NUM_WORDS = ["", "one", "two", "three", "four", "five", "six"];

function fluxRegions(n, aspect) {
  const a = normalizeAspect(aspect);
  const [w, h] = a.split(":").map(Number);
  const tall = h > w;
  if (n === 2) return tall ? ["In the upper half", "In the lower half"] : ["On the left", "On the right"];
  if (n === 3) return tall ? ["At the top", "In the middle", "At the bottom"] : ["On the left", "In the center", "On the right"];
  if (n === 4) return ["In the upper left", "In the upper right", "In the lower left", "In the lower right"];
  return Array.from({ length: n }, (_, i) => `Focal element ${i + 1}`);
}

/**
 * opts.extraBuzz — the Spellforge "Extra buzz" field (request `extra_buzz`); falls back to the
 * stasis "Extra direction:" line. It is always included verbatim near the start of the prompt.
 * Spells get equal, bounded shares, each placed in its own region of one scene.
 */
export function buildCloudflarePrompt(stasis, buzzWords, aspect, opts = {}) {
  const sf = parseSpellforgeStasis(stasis);
  const gen = sf && sf.subjects.length ? null : parseGenericStasis(stasis);
  const genExtra = gen ? (/^Extra direction[^:\n]*:[ \t]*([^\n]+)/m.exec(String(stasis || "")) || [])[1] : "";
  const extra = fluxExtraBuzz((opts && opts.extraBuzz) || (sf ? sf.extra : genExtra) || "");
  const colors = (sf ? sf.colors : gen.colors) || [];
  const moods = sf ? sf.moods.slice(0, 2) : [];
  const styles = sf ? sf.styles.filter((x) => !FLUX_NON_PAINT_STYLE_RE.test(x)).slice(0, 3) : [];
  const subjectText = gen ? gen.text.replace(/(^|\s)Extra direction[^:]*:[^.]*\.?/i, " ").trim() : "";
  const mediumNamed = FLUX_MEDIUM_RE.test(extra) || (gen && FLUX_MEDIUM_RE.test(subjectText));
  const medium = mediumNamed ? "A painting" : "An expressive fine-art oil painting";
  const extraLine = extra ? `Prominently featuring: ${extra}.` : "";

  const tail = [];
  if (!mediumNamed) tail.push("Visible brushstrokes.");
  if (styles.length) tail.push("Style influences: " + styles.join(", ").toLowerCase() + ".");
  if (colors.length) tail.push("Dominant colors: " + colors.join(", ") + ".");
  if (moods.length) tail.push("Mood: " + moods.join(", ").toLowerCase().replace(/[.…]+$/, "") + ".");
  tail.push(fluxFraming(aspect));
  tail.push("No text, no signature, no watermark.");
  const tailText = tail.join(" ");

  let prompt;
  if (sf && sf.subjects.length) {
    const subs = sf.subjects.slice(0, 4);
    const n = subs.length;
    const word = FLUX_NUM_WORDS[n] || String(n);
    const wide = /^Wide/.test(fluxFraming(aspect));
    // The user's words lead the prompt verbatim (FLUX weighs the opening most), are restated in the
    // opener and, reordered, in the closing line so a later item is not drowned by the first one.
    const shortExtra = extra && extra.length <= 160;
    const items = extra.split(/\s*,\s*/).filter(Boolean);
    const rotated = items.length > 1 ? items.slice().reverse().join(", ") : extra;
    const lead = extra ? (shortExtra ? extra.charAt(0).toUpperCase() + extra.slice(1) : extra) + "." : "";
    const opener =
      `${medium} of one single seamless ${wide ? "panoramic " : ""}scene` +
      (shortExtra ? `, prominently featuring ${extra}, ${items.length > 1 ? "each" : ""} clearly visible,` : "") +
      (n > 1 ? ` with ${word} equal focal elements of the same size and prominence.` : ` with one clear focal subject.`);
    const unifier =
      n > 1
        ? `${n === 2 ? "Both" : "All " + word} stand together in the same continuous landscape with equal visual weight` +
          (shortExtra ? `, surrounded by ${rotated}.` : ".")
        : shortExtra
          ? `Surrounded by ${rotated}.`
          : "";
    const fixedLen = lead.length + opener.length + unifier.length + tailText.length + 20 * n + 8;
    const cap = Math.max(110, Math.min(n === 1 ? 420 : 260, Math.floor((FLUX_PROMPT_TARGET - fixedLen) / n)));
    // Balance: every spell gets the same bounded share, and none may run much longer than the
    // shortest one (a long first sentence is trimmed to its core clause).
    let cores = subs.map((d) => fluxSpellCore(d.desc, cap));
    if (n > 1) {
      const shortest = Math.min(...cores.map((c) => c.length));
      const even = Math.max(120, Math.round(shortest * 1.3));
      if (cores.some((c) => c.length > even)) cores = subs.map((d) => fluxSpellCore(d.desc, Math.min(cap, even)));
    }
    const regions = n > 1 ? fluxRegions(n, aspect) : ["At the center"];
    const lcArticle = (c) => c.replace(/^(A|An|The|Two|Three|Several|Many)\b/, (w) => w.toLowerCase());
    const body = cores.map((c, i) => `${i ? regions[i].toLowerCase() : regions[i]}, ${lcArticle(c)}`).join("; ") + ".";
    prompt = [lead, opener.replace(/,\s+clearly/, ", clearly").replace(/\s+,/g, ","), body, unifier, tailText]
      .filter(Boolean)
      .join(" ");
  } else {
    const budget = Math.max(300, FLUX_PROMPT_TARGET - tailText.length - extraLine.length - medium.length - 80);
    let subject = fluxLeadSentences(subjectText, budget);
    const subjectMax = CF_PROMPT_MAX - tailText.length - extraLine.length - medium.length - 8;
    if (subject.length > subjectMax) subject = clipPromptChars(subject, subjectMax);
    const lower = (subject + " " + extra).toLowerCase();
    const details = (buzzWords || [])
      .map((b) => String(b || "").trim())
      .filter((b) => b && !/^#?[0-9a-f]{6}$/i.test(b) && !/\d+\s*[:/]\s*\d+|aspect/i.test(b))
      .filter((b) => !FLUX_BUZZ_SKIP_RE.test(b) && !lower.includes(b.toLowerCase()))
      .filter((b) => !colors.some((c) => c.toLowerCase() === b.toLowerCase()))
      .slice(0, 6);
    const detailText = details.length ? "Details: " + details.join(", ") + "." : "";
    const lead = FLUX_MEDIUM_RE.test(subject) ? "" : medium + ".";
    prompt = [extraLine, subject, detailText, lead, tailText].filter(Boolean).join(" ");
    if (prompt.replace(/\s+/g, " ").length > CF_PROMPT_MAX) prompt = [extraLine, subject, lead, tailText].filter(Boolean).join(" ");
  }
  prompt = prompt.replace(/\s+/g, " ").trim();
  if (prompt.length > CF_PROMPT_MAX) {
    // Only reachable with a huge extra + long run-on text; keep extra and the tail.
    prompt = clipPromptChars(prompt.slice(0, prompt.length - tailText.length), CF_PROMPT_MAX - tailText.length - 1) + " " + tailText;
  }
  return prompt;
}

/** Text-to-image via Cloudflare Workers AI REST. Reference images are ignored. Returns a data: URL. */
export async function generateCloudflareStasisImage(stasis, buzzWords, aspectRatio, opts = {}) {
  const creds = getCfCreds();
  if (!creds) {
    throw new Error(
      "Cloudflare Workers AI is not configured (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)."
    );
  }
  const model = getCfImageModel();
  const aspect = normalizeAspect(aspectRatio);
  const payload = { prompt: buildCloudflarePrompt(stasis, buzzWords, aspect, opts) };
  const isSdxl = /stable-diffusion-xl/i.test(model);
  if (isSdxl) {
    const sized = aspectToSize(aspect, 1024);
    payload.width = Math.max(256, Math.floor(sized.width / 8) * 8);
    payload.height = Math.max(256, Math.floor(sized.height / 8) * 8);
  } else if (/flux-1-schnell/i.test(model)) {
    payload.steps = getCfFluxSteps();
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

export async function generateStasisVisionImage(stasis, buzzWords, aspectRatio, referenceImage, cfOpts = {}) {
  const provider = getImageProvider();
  if (provider === "cloudflare") {
    return generateCloudflareStasisImage(stasis, buzzWords, aspectRatio, cfOpts);
  }
  if (provider === "wombo") {
    return generateWomboStasisImage(stasis, buzzWords, aspectRatio);
  }
  try {
    return await generateXaiStasisImage(stasis, buzzWords, aspectRatio, referenceImage);
  } catch (err) {
    if (getCfCreds() && shouldUseCloudflareFallback(err)) {
      try {
        return await generateCloudflareStasisImage(stasis, buzzWords, aspectRatio, cfOpts);
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