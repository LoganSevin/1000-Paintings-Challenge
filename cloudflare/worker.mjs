// Cloudflare Worker entry for logan7in.art (Workers + static assets, free plan).
// Static files are served straight from the assets upload (no Worker invocation);
// this script only runs for /api/*, /.netlify/functions/* and the packed JSON
// collections (see cloudflare/build.mjs). The handlers are the exact same files
// Netlify runs (netlify/functions/*.mjs); "@netlify/blobs" is aliased to the D1
// shim in wrangler.jsonc.
import process from "node:process";
import { setBlobsDatabase } from "./blobs-d1.mjs";
import { servePacked, PACKED_PREFIXES } from "./packs.mjs";

import authConfig from "../netlify/functions/auth-config.mjs";
import authGoogle from "../netlify/functions/auth-google.mjs";
import blendSpells from "../netlify/functions/blend-spells.mjs";
import claudeChat from "../netlify/functions/claude-chat.mjs";
import galleryCheckin from "../netlify/functions/gallery-checkin.mjs";
import generateStasisVision from "../netlify/functions/generate-stasis-vision.mjs";
import health from "../netlify/functions/health.mjs";
import jobStatus from "../netlify/functions/job-status.mjs";
import openaiChat from "../netlify/functions/openai-chat.mjs";
import pageChat from "../netlify/functions/page-chat.mjs";
import presence from "../netlify/functions/presence.mjs";
import serverWindow from "../netlify/functions/server-window.mjs";
import proxyMedia from "../netlify/functions/proxy-media.mjs";
import pulseFeed from "../netlify/functions/pulse-feed.mjs";
import pulsePosts from "../netlify/functions/pulse-posts.mjs";
import redefineStasis from "../netlify/functions/redefine-stasis.mjs";
import transfer from "../netlify/functions/transfer.mjs";
import transferUpload from "../netlify/functions/transfer-upload.mjs";
import xaiUsage from "../netlify/functions/xai-usage.mjs";

// Function name -> handler (also reachable as /.netlify/functions/<name>).
export const FUNCTIONS = {
  "auth-config": authConfig,
  "auth-google": authGoogle,
  "blend-spells": blendSpells,
  "claude-chat": claudeChat,
  "gallery-checkin": galleryCheckin,
  "generate-stasis-vision": generateStasisVision,
  health,
  "job-status": jobStatus,
  "openai-chat": openaiChat,
  "page-chat": pageChat,
  presence,
  "server-window": serverWindow,
  "proxy-media": proxyMedia,
  "pulse-feed": pulseFeed,
  "pulse-posts": pulsePosts,
  "redefine-stasis": redefineStasis,
  transfer,
  "transfer-upload": transferUpload,
  "xai-usage": xaiUsage,
};

// Mirrors the [[redirects]] in netlify.toml (and _redirects). Order matters.
const API_ROUTES = [
  ["/api/health", "health"],
  ["/api/blend-spells", "blend-spells"],
  ["/api/redefine-stasis", "redefine-stasis"],
  ["/api/generate-stasis-vision", "generate-stasis-vision"],
  ["/api/proxy-media", "proxy-media"],
  ["/api/transfer/upload", "transfer-upload"],
  ["/api/transfer/*", "transfer"],
  ["/api/transfer", "transfer"],
  ["/api/gallery-checkin", "gallery-checkin"],
  ["/api/xai-usage", "xai-usage"],
  ["/api/credits", "xai-usage"],
  ["/api/page-chat", "page-chat"],
  ["/api/presence", "presence"],
  ["/api/server-window", "server-window"],
  ["/api/pulse/feed", "pulse-feed"],
  ["/api/pulse/posts", "pulse-posts"],
  ["/api/jobs/:jobId", "job-status"],
  ["/api/auth/config", "auth-config"],
  ["/api/auth/google", "auth-google"],
  ["/api/claude-chat", "claude-chat"],
  ["/api/openai-chat", "openai-chat"],
];

export function matchRoute(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const fn = path.match(/^\/\.netlify\/functions\/([a-z0-9-]+)(\/.*)?$/);
  if (fn && FUNCTIONS[fn[1]]) {
    const params = {};
    if (fn[1] === "job-status" && fn[2]) params.jobId = decodeURIComponent(fn[2].slice(1).split("/")[0]);
    return { name: fn[1], params };
  }
  for (const [pattern, name] of API_ROUTES) {
    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2);
      if (path.startsWith(base + "/")) return { name, params: {} };
    } else if (pattern.includes("/:")) {
      const [base, param] = pattern.split("/:");
      if (path.startsWith(base + "/")) {
        const rest = path.slice(base.length + 1);
        if (rest && !rest.includes("/")) return { name, params: { [param]: decodeURIComponent(rest) } };
      }
    } else if (path === pattern) {
      return { name, params: {} };
    }
  }
  return null;
}

let envSynced = null;
function syncEnv(env) {
  // nodejs_compat (compatibility_date >= 2025-04-01) already fills process.env
  // from vars/secrets; this is a fallback so the handlers' process.env reads
  // work regardless of the flag.
  if (envSynced === env) return;
  envSynced = env;
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v === "string" && process.env[k] === undefined) process.env[k] = v;
  }
}

function errorJson(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    for (const prefix of PACKED_PREFIXES) {
      if (url.pathname.startsWith(prefix)) return servePacked(request, env, url, ctx);
    }

    const route = matchRoute(url.pathname);
    if (!route) {
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) {
        return errorJson("Not found", 404);
      }
      return env.ASSETS.fetch(request);
    }

    syncEnv(env);
    setBlobsDatabase(env.DB);

    // Netlify-style context. No waitUntil on purpose: Workers cap waitUntil at
    // ~30 s after the response, while the image fallback chain can take longer.
    // Without it, generate-stasis-vision finishes the job inside the request
    // (no wall-clock limit while the client is connected; waiting on fetch does
    // not count as CPU time) and then answers 202 + job_id as before.
    const context = {
      params: route.params,
      ip: request.headers.get("cf-connecting-ip") || "",
      geo: request.cf
        ? { country: { code: request.cf.country }, city: request.cf.city, timezone: request.cf.timezone }
        : {},
      requestId: request.headers.get("cf-ray") || "",
      site: { url: url.origin },
      deploy: { context: "production" },
      account: {},
      cookies: { get() { return undefined; }, set() {}, delete() {} },
      json: (body, init) => Response.json(body, init),
    };

    try {
      const res = await FUNCTIONS[route.name](request, context);
      if (route.name === "health" && res && res.status === 200) {
        const body = await res.json();
        body.host = "cloudflare";
        body.storage = env.DB ? "d1" : "missing";
        return new Response(JSON.stringify(body), { status: 200, headers: res.headers });
      }
      return res || new Response(null, { status: 204 });
    } catch (e) {
      return errorJson((e && e.message) || String(e), 500);
    }
  },
};
