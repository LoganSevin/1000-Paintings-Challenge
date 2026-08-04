import {
  API_RESPONSES,
  TEXT_MODEL,
  getApiKey,
  apiErrorMessage,
  loadAnalyses,
  extractResponseText,
  parseJsonBlob,
  jsonResponse,
} from "./_lib.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405);
  }

  try {
    const body = await request.json();
    const spells = (body.spells || []).map((n) => parseInt(n, 10)).filter((n) => n >= 1);
    if (spells.length < 2) {
      return jsonResponse({ error: "Equip at least 2 spells (I, II, III) to blend." }, 400);
    }

    const analyses = loadAnalyses();
    const spellsData = spells.slice(0, 3).map((num) => {
      const a = analyses[String(num)] || analyses[num] || {};
      return {
        number: num,
        title: a.title || "",
        description: a.description || "",
        style: a.style || "",
        mood: a.mood || "",
        tags: a.tags || [],
        colors: a.colors || [],
      };
    });

    const apiKey = getApiKey();
    const userText =
      "Fuse these paintings into one unified spell. Interweave their imagery in a single " +
      "mixed description (do not list them separately). Return ONLY JSON:\n" +
      '{"fused_title":"max 8 words","mixed_description":"3-4 sentences blending ALL",' +
      '"combined_styles":["unique styles from all"],' +
      '"combined_tags":["up to 12 unique tags"],' +
      '"combined_mood":"short fused mood"}\n\n' +
      JSON.stringify(spellsData);

    const resp = await fetch(API_RESPONSES, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        input: [{ role: "user", content: userText }],
        store: false,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return jsonResponse({ error: apiErrorMessage(data, resp.status) }, 400);
    }

    const fused = parseJsonBlob(extractResponseText(data));
    fused.spells = spells.slice(0, 3);
    return jsonResponse(fused);
  } catch (e) {
    return jsonResponse({ error: e.message || String(e) }, 400);
  }
}