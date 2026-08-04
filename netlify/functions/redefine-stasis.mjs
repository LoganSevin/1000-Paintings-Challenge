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
      return jsonResponse({ error: "Equip at least 2 spells to redefine stasis." }, 400);
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

    const current = String(body.stasis || "").trim();
    const variant = parseInt(body.variant || "0", 10) || 0;
    const apiKey = getApiKey();
    const userText =
      "Refine a fused spell STASIS — one singular unified entity from three paintings.\n" +
      "Rewrite the current stasis with fresh vocabulary and sentence structure. " +
      "Keep the same fused meaning and imagery, but do NOT reuse wording from " +
      "the individual source descriptions below or repeat phrases from the current stasis.\n" +
      "Describe all three as ONE vision — never list them separately or say 'spell one/two'.\n" +
      `Variation pass: ${variant + 1}\n\n` +
      "Return ONLY JSON:\n" +
      '{"mixed_description":"3-4 sentences, singular fused voice",' +
      '"fused_title":"optional max 8 words"}\n\n' +
      "SOURCE SPELLS (reference only — do not copy their phrasing):\n" +
      JSON.stringify(spellsData) +
      "\n\nCURRENT STASIS (rewrite this):\n" +
      (current || "(generate a first unified fusion from the source spells)");

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

    const result = parseJsonBlob(extractResponseText(data));
    if (!String(result.mixed_description || "").trim()) {
      return jsonResponse({ error: "Redefine returned no description." }, 400);
    }
    result.spells = spells.slice(0, 3);
    return jsonResponse(result);
  } catch (e) {
    return jsonResponse({ error: e.message || String(e) }, 400);
  }
}