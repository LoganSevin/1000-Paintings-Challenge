import { Buffer } from "node:buffer";
import { getStore } from "@netlify/blobs";
import {
  API_RESPONSES,
  TEXT_MODEL,
  apiErrorMessage,
  extractResponseText,
  parseJsonBlob,
  withXaiKeyFallback,
  isCreditsLimitError,
} from "./_lib.mjs";

const PHONE_UPLOAD_ANALYSIS_PROMPT =
  "Phone-uploaded photo for a local art gallery. Study the image carefully.\n" +
  "Describe ONLY what is actually visible. Also write a dense generation prompt (prompt-weight text) that could recreate this image's look for later casting / generation.\n" +
  "Return ONLY JSON:\n" +
  '{"title":"max 6 words","description":"2 accurate sentences of what is visible","prompt":"one paragraph generation prompt 50-120 words, concrete visual language, no 4k/masterpiece/hashtags","style":"category","medium":"guess","mood":"1-3 words","subject_type":"photo|painting|object|portrait|scene|other","tags":["up to 6 tags"],"colors":["up to 4 colors"]}';

export const TAB_BOX = "phone-uploads";
export const MAX_BYTES = 3.2 * 1024 * 1024;
export const MAX_ITEMS = 400;

export function safeName(name) {
  const cleaned = String(name || "upload.jpg")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return cleaned || "upload.jpg";
}

export function fileUrl(id) {
  return "/api/transfer/file?id=" + encodeURIComponent(id);
}

export function decodeDataUrl(raw) {
  let mime = "image/jpeg";
  let b64 = String(raw || "").trim();
  if (!b64) return null;
  if (b64.startsWith("data:") && b64.includes(",")) {
    const header = b64.slice(0, b64.indexOf(","));
    b64 = b64.slice(b64.indexOf(",") + 1);
    const m = header.match(/data:([^;]+)/i);
    if (m) mime = m[1].trim().toLowerCase() || mime;
  }
  b64 = b64.replace(/\s+/g, "");
  if (!b64) return null;
  let buf;
  try {
    buf = Buffer.from(b64, "base64");
  } catch (e) {
    return null;
  }
  if (!buf || !buf.length) return null;
  return { buf, mime: sniffMime(buf, mime) };
}

export function sniffMime(buf, fallback) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.length > 12 && buf[0] === 0x52 && buf[8] === 0x57) return "image/webp";
  return fallback || "image/jpeg";
}

export function toListItem(row) {
  const id = String(row.id || "");
  const analysis = row.analysis && typeof row.analysis === "object" ? row.analysis : null;
  const ready = !!(analysis && (analysis.description || analysis.prompt || analysis.title));
  return {
    id: id || row.name,
    name: row.name,
    title: (analysis && analysis.title) || row.title || row.name,
    url: row.url || fileUrl(id),
    phone_url: row.url || fileUrl(id),
    collection: TAB_BOX,
    source: "phone-upload",
    kind: "phone-upload",
    created: row.created,
    contentType: row.contentType,
    size: row.size,
    description: (analysis && analysis.description) || row.description || "",
    prompt: (analysis && analysis.prompt) || row.prompt || "",
    analysisStatus: row.analysisStatus || (ready ? "ready" : "none"),
    analysisError: row.analysisError || "",
    analysis,
  };
}

function parseAnalysisText(text) {
  try {
    return parseJsonBlob(text);
  } catch (e) {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw e;
  }
}

function extractAnyText(body) {
  let text = extractResponseText(body);
  if (text) return text;
  if (typeof body?.output_text === "string" && body.output_text.trim()) return body.output_text;
  for (const item of body?.output || []) {
    if (!item) continue;
    if ((item.type === "output_text" || item.type === "text") && item.text) return item.text;
    if (typeof item.text === "string" && item.text.trim()) return item.text;
    for (const block of item.content || []) {
      if (block && (block.text || block.output_text)) return block.text || block.output_text;
    }
  }
  const choice = body?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(choice)) {
    return choice.map((part) => part?.text || part?.content || "").join("");
  }
  return "";
}

async function readXaiJson(resp) {
  const raw = await resp.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (e) {
    if (!resp.ok) throw new Error((raw || "HTTP " + resp.status).slice(0, 220));
    throw new Error("xAI returned non-JSON");
  }
  if (!resp.ok) throw new Error(apiErrorMessage(data, resp.status));
  return data;
}

function withPrompt(result) {
  const row = result && typeof result === "object" ? result : {};
  if (String(row.prompt || "").trim()) return row;
  const parts = [];
  if (row.title) parts.push(String(row.title));
  if (row.description) parts.push(String(row.description));
  const meta = [];
  if (row.style) meta.push(row.style + " style");
  if (row.mood) meta.push(row.mood + " mood");
  if (row.medium) meta.push(String(row.medium));
  if (meta.length) parts.push(meta.join(", "));
  if (Array.isArray(row.tags) && row.tags.length) parts.push(row.tags.slice(0, 8).join(", "));
  if (Array.isArray(row.colors) && row.colors.length) {
    parts.push("palette: " + row.colors.slice(0, 5).join(", "));
  }
  row.prompt = parts.filter(Boolean).join(". ").replace(/\.\./g, ".").trim();
  return row;
}

async function describeViaResponses(apiKey, model, dataUrl) {
  const resp = await fetch(API_RESPONSES, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: dataUrl, detail: "low" },
            { type: "input_text", text: PHONE_UPLOAD_ANALYSIS_PROMPT },
          ],
        },
      ],
      store: false,
    }),
  });
  const data = await readXaiJson(resp);
  const text = extractAnyText(data);
  if (!text) throw new Error("Empty description from " + model);
  return withPrompt(parseAnalysisText(text));
}

async function describeViaChat(apiKey, model, dataUrl) {
  const resp = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
            { type: "text", text: PHONE_UPLOAD_ANALYSIS_PROMPT },
          ],
        },
      ],
    }),
  });
  const data = await readXaiJson(resp);
  const text = extractAnyText(data);
  if (!text) throw new Error("Empty chat description from " + model);
  return withPrompt(parseAnalysisText(text));
}

function unlimitedLocalDescribe() {
  return {
    title: "Phone still",
    description:
      "Phone upload under Logan7in unlimited. Cloud caption is optional and was skipped so the studio stays uncapped.",
    prompt:
      "Faithful painterly still from a phone photograph, concrete light and materials, no 4k, no masterpiece, no hashtags.",
    style: "photographic",
    medium: "photograph",
    mood: "present",
    subject_type: "photo",
    tags: ["phone", "unlimited"],
    colors: [],
    kind: "phone-upload",
    analyzed_at: new Date().toISOString(),
    model: "logan7in-unlimited-local",
  };
}

export async function describePhoneImage(buf, mime) {
  const type = sniffMime(buf, mime || "image/jpeg");
  const b64 = Buffer.from(buf).toString("base64");
  const dataUrl = "data:" + type + ";base64," + b64;
  const models = [TEXT_MODEL, "grok-4.7", "grok-4"].filter(function (name, i, arr) {
    return name && arr.indexOf(name) === i;
  });
  try {
  return await withXaiKeyFallback(async function (apiKey) {
    let lastErr = "Describe failed";
    for (let i = 0; i < models.length; i++) {
      try {
        const analysis = await describeViaResponses(apiKey, models[i], dataUrl);
        analysis.kind = "phone-upload";
        analysis.analyzed_at = new Date().toISOString();
        analysis.model = models[i];
        return analysis;
      } catch (err) {
        lastErr = String((err && err.message) || err);
        if (String(lastErr).toLowerCase().includes("credit") || String(lastErr).toLowerCase().includes("spending")) {
          throw err;
        }
      }
    }
    try {
      const analysis = await describeViaChat(apiKey, models[0] || "grok-4.7", dataUrl);
      analysis.kind = "phone-upload";
      analysis.analyzed_at = new Date().toISOString();
      analysis.model = (models[0] || "grok-4.7") + "-chat";
      return analysis;
    } catch (err) {
      throw new Error(String((err && err.message) || lastErr).slice(0, 240));
    }
  });
  } catch (err) {
    if (isCreditsLimitError(err)) return unlimitedLocalDescribe();
    throw err;
  }
}

export async function patchPhoneItem(store, id, patch) {
  const items = await loadIndex(store);
  let found = null;
  const next = items.map(function (row) {
    if (String(row.id) !== String(id)) return row;
    found = Object.assign({}, row, patch);
    return found;
  });
  if (!found) {
    const err = new Error("Upload not found");
    err.status = 404;
    throw err;
  }
  await saveIndex(store, next);
  return found;
}

export async function describeSavedPhone(store, id) {
  const key = String(id || "").replace(/[^A-Za-z0-9._-]/g, "");
  if (!key) {
    const err = new Error("id required");
    err.status = 400;
    throw err;
  }
  const meta = await store.getWithMetadata("file/" + key, { type: "arrayBuffer" });
  if (!meta || !meta.data) {
    const err = new Error("Photo file missing");
    err.status = 404;
    throw err;
  }
  const mime = (meta.metadata && (meta.metadata.contentType || meta.metadata.contenttype)) || "image/jpeg";
  const buf = Buffer.from(meta.data);
  const analysis = await describePhoneImage(buf, mime);
  return patchPhoneItem(store, key, {
    analysis,
    analysisStatus: "ready",
    title: analysis.title || undefined,
    description: analysis.description || "",
    prompt: analysis.prompt || "",
    analysisError: "",
  });
}

export function phoneStore() {
  return getStore({ name: "phone-uploads", consistency: "strong" });
}

export async function loadIndex(store) {
  try {
    const data = await store.get("index", { type: "json" });
    const items = data && Array.isArray(data.items) ? data.items : [];
    return items.filter((row) => row && row.id);
  } catch (e) {
    return [];
  }
}

export async function saveIndex(store, items) {
  const next = { items: items.slice(0, MAX_ITEMS) };
  for (let attempt = 0; attempt < 8; attempt++) {
    const meta = await store.getWithMetadata("index", { type: "json" });
    const options = meta && meta.etag ? { onlyIfMatch: meta.etag } : { onlyIfNew: true };
    const result = await store.setJSON("index", next, options);
    if (result && result.modified) return next.items;
  }
  await store.setJSON("index", next);
  return next.items;
}

export async function savePhoneImage(store, buf, mime, filename) {
  if (!buf || !buf.length) {
    const err = new Error("Empty photo");
    err.status = 400;
    throw err;
  }
  if (buf.length > MAX_BYTES) {
    const err = new Error("Image too large — try a screenshot or a smaller JPEG");
    err.status = 400;
    throw err;
  }
  const id = "ph-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const name = safeName(filename || "upload.jpg");
  const type = sniffMime(buf, mime || "image/jpeg");
  await store.set("file/" + id, buf instanceof Uint8Array ? buf : new Uint8Array(buf), {
    metadata: { contentType: type, filename: name },
  });
  const item = {
    id,
    name,
    title: name.replace(/\.[^.]+$/, "") || name,
    created: Date.now(),
    contentType: type,
    size: buf.length,
    url: fileUrl(id),
    analysisStatus: "analyzing",
  };
  try {
    const analysis = await describePhoneImage(buf, type);
    item.analysis = analysis;
    item.analysisStatus = "ready";
    item.title = analysis.title || item.title;
    item.description = analysis.description || "";
    item.prompt = analysis.prompt || "";
  } catch (err) {
    item.analysisStatus = "failed";
    item.analysisError = String((err && err.message) || err).slice(0, 240);
  }
  const items = await loadIndex(store);
  items.unshift(item);
  await saveIndex(store, items);
  return {
    ok: true,
    name,
    id,
    url: fileUrl(id),
    box: TAB_BOX,
    size: buf.length,
    title: item.title,
    description: item.description || "",
    prompt: item.prompt || "",
    analysis: item.analysis || null,
    analysisStatus: item.analysisStatus,
    analysisError: item.analysisError || "",
    inGeneratorMix: true,
  };
}
