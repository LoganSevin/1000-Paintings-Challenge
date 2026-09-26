import {
  getCfCreds,
  getCfImageModel,
  getImageFallbackChain,
  getImageProvider,
  getPollinationsKey,
  getPollinationsModel,
  getWomboKey,
  getXaiKey,
  isImageApiConfigured,
  jsonResponse,
} from "./_lib.mjs";

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
    cloudflare_configured: !!getCfCreds(),
    fallback_provider: getCfCreds() ? "cloudflare" : getWomboKey() ? "wombo" : null,
    cloudflare_image_model: getCfCreds() ? getCfImageModel() : null,
    pollinations_configured: !!getPollinationsKey(),
    pollinations_image_model: getPollinationsKey() ? getPollinationsModel() : null,
    fallback_chain: getImageFallbackChain(),
    local_generate: true,
  });
}