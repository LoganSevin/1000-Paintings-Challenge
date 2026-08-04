import { getImageProvider, getWomboKey, getXaiKey, isImageApiConfigured, jsonResponse } from "./_lib.mjs";

export default async function handler() {
  const provider = getImageProvider();

  return jsonResponse({
    ok: true,
    spellforge: true,
    api_version: 3,
    stasis_vision: true,
    host: "netlify",
    image_provider: provider,
    api_configured: isImageApiConfigured(),
    xai_configured: !!getXaiKey(),
    wombo_configured: !!getWomboKey(),
    local_generate: true,
  });
}