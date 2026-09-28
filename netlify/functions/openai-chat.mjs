import { jsonResponse, corsPreflight } from "./_lib.mjs";

const MODEL = process.env.OPENAI_MODEL || "gpt-4.1";

function visitorKey(request) {
  if (!request || !request.headers) return "";
  return String(
    request.headers.get("x-visitor-openai-key") ||
      request.headers.get("X-Visitor-OpenAI-Key") ||
      ""
  ).trim();
}

function extractText(data) {
  const choices = (data && data.choices) || [];
  const msg = choices[0] && choices[0].message;
  if (msg && typeof msg.content === "string") return msg.content.trim();
  if (data && typeof data.output_text === "string") return data.output_text.trim();
  return "";
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  const key = visitorKey(request);
  if (!key) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Paste your OpenAI API key on the ChatGPT tab. Logan7in unlimited does not bill OpenAI to the studio.",
      },
      400
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const raw = Array.isArray(body && body.messages) ? body.messages : [];
  const messages = [];
  const system =
    String((body && body.system) || "").trim() ||
    "You are in Logan Sevin’s 1000 Paintings Challenge studio. Help with the gallery. Authorship stays with Logan Sevin.";
  messages.push({ role: "system", content: system });
  for (const item of raw.slice(-24)) {
    if (!item || typeof item !== "object") continue;
    const role = String(item.role || "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const text = String(item.content || item.text || "").trim().slice(0, 4000);
    if (!text) continue;
    messages.push({ role, content: text });
  }
  if (messages.length < 2) return jsonResponse({ ok: false, error: "messages array required" }, 400);

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
    }),
  });
  const data = await resp.json().catch(function () {
    return {};
  });
  if (!resp.ok) {
    const err =
      (data && data.error && data.error.message) || "ChatGPT HTTP " + resp.status;
    return jsonResponse({ ok: false, error: String(err).slice(0, 400) }, resp.status === 401 ? 401 : 502);
  }
  const text = extractText(data);
  if (!text) return jsonResponse({ ok: false, error: "Empty reply from ChatGPT" }, 502);
  return jsonResponse({ ok: true, text, model: (data && data.model) || MODEL });
}
