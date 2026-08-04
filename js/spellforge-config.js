/**
 * FREE public share link (no domain purchase):
 *   https://1000-l7in.netlify.app/
 *   https://1000-l7in.netlify.app/#spellforge
 *
 * After you create Render (see SETUP_1000-l7in.md), paste your Render URL below.
 * Leave "" for local testing with start_server.bat only.
 */
window.SPELLFORGE_API_BASE = window.SPELLFORGE_API_BASE || "";
window.GALLERY_PUBLIC_URL = window.GALLERY_PUBLIC_URL || "https://1000-l7in.netlify.app/";

/**
 * false (default) = ALWAYS use xAI/cloud for Spellforge Generate.
 * true = only then use free in-browser painting fuse (lower quality).
 * Do not turn this on unless you intentionally want free fuse.
 */
window.SPELLFORGE_LOCAL_GENERATE =
  typeof window.SPELLFORGE_LOCAL_GENERATE === "boolean"
    ? window.SPELLFORGE_LOCAL_GENERATE
    : false;

/**
 * false (default) = if xAI is out of credits, show an error (do not auto free-fuse).
 * true = allow ugly local fuse only after a confirmed credits error.
 */
window.SPELLFORGE_LOCAL_FALLBACK_ON_CREDITS =
  typeof window.SPELLFORGE_LOCAL_FALLBACK_ON_CREDITS === "boolean"
    ? window.SPELLFORGE_LOCAL_FALLBACK_ON_CREDITS
    : false;

/** Legacy override — same as setting SPELLFORGE_LOCAL_GENERATE to false. */
window.SPELLFORGE_USE_CLOUD_AI = !!window.SPELLFORGE_USE_CLOUD_AI;

// window.SPELLFORGE_API_BASE = "https://YOUR-APP-NAME.onrender.com";
