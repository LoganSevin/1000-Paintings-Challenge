// Netlify `ignore` command (see [build] ignore in netlify.toml).
// Exit 0 = skip this build, exit 1 = build.
//
// Production builds from main cost 15 Netlify credits each, so they only run
// when the commit being built says "[deploy]" in its message (a squash-merge
// title or body works too). Deploy Previews and branch deploys are free and
// always build. If the message can't be read, build (fail open).
// Build hooks bypass this check entirely (Netlify behavior).
"use strict";
const { execSync } = require("child_process");

const TAG = /\[deploy\]/i;

function decide(env, readMessage) {
  const context = String(env.CONTEXT || "");
  if (context !== "production") {
    return { build: true, reason: `context "${context || "unknown"}" always builds` };
  }
  let message = "";
  try {
    message = String(readMessage(env.COMMIT_REF) || "");
  } catch (e) {
    return { build: true, reason: "could not read commit message; building to be safe" };
  }
  if (TAG.test(message)) return { build: true, reason: "commit message contains [deploy]" };
  return {
    build: false,
    reason: "production build skipped: latest commit message has no [deploy] (saves 15 credits)",
  };
}

function gitMessage(ref) {
  const safeRef = /^[0-9a-f]{7,40}$/i.test(String(ref || "")) ? ref : "HEAD";
  return execSync(`git log -1 --pretty=%B ${safeRef}`, { encoding: "utf8" });
}

if (require.main === module) {
  const result = decide(process.env, gitMessage);
  console.log(`[netlify-ignore] ${result.reason}`);
  process.exit(result.build ? 1 : 0);
}

module.exports = { decide };
