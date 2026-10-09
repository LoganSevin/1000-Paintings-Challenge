// Cloudflare Worker entry for logan7in.art (Workers + static assets, free plan).
// Static files are served straight from the assets upload (no Worker invocation);
// this script only runs for /api/*, /.netlify/functions/* and the packed JSON
// collections (see cloudflare/build.mjs). The handlers are the exact same files
// Netlify runs (netlify/functions/*.mjs); "@netlify/blobs" is aliased to the
// blob shim in wrangler.jsonc (Durable Object or D1 backend).
// It also serves the generated images at /generated/* from the separate
// assets-only Worker "l7in-generated" (service binding GENERATED) and tells the
// page to use them instead of l7in-generated.netlify.app.
import process from "node:process";
import { Buffer } from "node:buffer";
import { setBlobsBackendFromEnv, getStore } from "./blobs-d1.mjs";
import { servePacked, PACKED_PREFIXES } from "./packs.mjs";

import animateCast from "../netlify/functions/animate-cast.mjs";
import authConfig from "../netlify/functions/auth-config.mjs";
import authGoogle from "../netlify/functions/auth-google.mjs";
import blendSpells from "../netlify/functions/blend-spells.mjs";
import cameoVideo from "../netlify/functions/cameo-video.mjs";
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

export { BlobStoreDO } from "./blobs-do.mjs";

// Function name -> handler (also reachable as /.netlify/functions/<name>).
export const FUNCTIONS = {
  "animate-cast": animateCast,
  "auth-config": authConfig,
  "auth-google": authGoogle,
  "blend-spells": blendSpells,
  "cameo-video": cameoVideo,
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
  ["/api/cameo-video", "cameo-video"],
  ["/api/animate-cast", "animate-cast"],
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

// HTML pages that get the generated-images flag injected (run_worker_first).
const HTML_PATHS = new Set(["/", "/index.html", "/subscribe", "/subscribe.html"]);
const GENERATED_FLAG = '<script>window.GENERATED_ORIGIN="";window.GALLERY_HOST="cloudflare";</script>';

async function serveHtml(request, env) {
  const res = await env.ASSETS.fetch(request);
  const type = res.headers.get("content-type") || "";
  if (!env.GENERATED || !type.includes("text/html")) return res;
  return new HTMLRewriter()
    .on("head", { element(el) { el.prepend(GENERATED_FLAG, { html: true }); } })
    .transform(res);
}

function serveGenerated(request, env, url) {
  if (!env.GENERATED) return new Response("Not found", { status: 404 });
  const target = new URL(url.pathname.slice("/generated".length) + url.search, "https://l7in-generated.internal");
  return env.GENERATED.fetch(new Request(target, request));
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i % (x.length || 1)] || 0) ^ (y[i % (y.length || 1)] || 0);
  return diff === 0;
}

// One-time data migration from Netlify Blobs (cloudflare/import-netlify-blobs.mjs
// --json). Disabled unless the ADMIN_TOKEN secret is set.
async function adminImport(request, env) {
  if (request.method !== "POST") return errorJson("Method not allowed", 405);
  const auth = request.headers.get("authorization") || "";
  if (!env.ADMIN_TOKEN || !auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), env.ADMIN_TOKEN)) {
    return errorJson("Unauthorized", 401);
  }
  const rows = await request.json();
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.store || r.key == null) continue;
    const value = r.enc === "b64" ? new Uint8Array(Buffer.from(String(r.data || ""), "base64")) : String(r.data || "");
    await getStore(r.store).set(String(r.key), value, r.metadata ? { metadata: r.metadata } : {});
    n++;
  }
  return Response.json({ imported: n });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/generated" || url.pathname.startsWith("/generated/")) return serveGenerated(request, env, url);
    if (HTML_PATHS.has(url.pathname)) return serveHtml(request, env);

    for (const prefix of PACKED_PREFIXES) {
      if (url.pathname.startsWith(prefix)) return servePacked(request, env, url, ctx);
    }

    if (url.pathname === "/api/_admin/blobs-import") {
      setBlobsBackendFromEnv(env);
      try {
        return await adminImport(request, env);
      } catch (e) {
        return errorJson((e && e.message) || String(e), 500);
      }
    }

    const route = matchRoute(url.pathname);
    if (!route) {
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) {
        return errorJson("Not found", 404);
      }
      return env.ASSETS.fetch(request);
    }

    syncEnv(env);
    const storage = setBlobsBackendFromEnv(env);

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
        body.storage = storage;
        body.generated_images = env.GENERATED ? "cloudflare" : "netlify";
        return new Response(JSON.stringify(body), { status: 200, headers: res.headers });
      }
      return res || new Response(null, { status: 204 });
    } catch (e) {
      return errorJson((e && e.message) || String(e), 500);
    }
  },
};
