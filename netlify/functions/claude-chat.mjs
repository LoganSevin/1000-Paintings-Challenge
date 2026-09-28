import { jsonResponse, corsPreflight } from "./_lib.mjs";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";

function visitorKey(request) {
  if (!request || !request.headers) return "";
  return String(
    request.headers.get("x-visitor-anthropic-key") ||
      request.headers.get("X-Visitor-Anthropic-Key") ||
      ""
  ).trim();
}

function extractText(data) {
  const blocks = (data && data.content) || [];
  const bits = [];
  for (const b of blocks) {
    if (!b) continue;
    if (typeof b.text === "string") bits.push(b.text);
    else if (b.type === "text" && typeof b.text === "string") bits.push(b.text);
  }
  return bits.join("\n").trim();
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
          "Paste your Anthropic API key on the Claude tab. Logan7in unlimited does not bill Claude to the studio.",
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
  for (const item of raw.slice(-24)) {
    if (!item || typeof item !== "object") continue;
    const role = String(item.role || "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const text = String(item.content || item.text || "").trim().slice(0, 4000);
    if (!text) continue;
    messages.push({ role, content: text });
  }
  if (!messages.length) return jsonResponse({ ok: false, error: "messages array required" }, 400);

  const system =
    String((body && body.system) || "").trim() ||
    "You are in Logan Sevin’s 1000 Paintings Challenge studio. Help with the gallery. Authorship stays with Logan Sevin.";

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
    }),
  });
  const data = await resp.json().catch(function () {
    return {};
  });
  if (!resp.ok) {
    const err =
      (data && data.error && (data.error.message || data.error.type)) ||
      "Claude HTTP " + resp.status;
    return jsonResponse({ ok: false, error: String(err).slice(0, 400) }, resp.status === 401 ? 401 : 502);
  }
  const text = extractText(data);
  if (!text) return jsonResponse({ ok: false, error: "Empty reply from Claude" }, 502);
  return jsonResponse({ ok: true, text, model: data.model || MODEL });
}
