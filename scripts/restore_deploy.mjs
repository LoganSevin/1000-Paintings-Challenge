import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gallery = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployId = process.argv[2] || "6a25c03f7dbaa45b2bf680aa";
const siteId = "0778e75e-0da7-4f9c-9c71-e64daafec66c";

const configPath = path.join(
  process.env.APPDATA || path.join(process.env.HOME || "", ".config"),
  "netlify",
  "Config",
  "config.json"
);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const token = config.users && Object.values(config.users)[0]?.auth?.token;
if (!token) {
  console.error("Netlify auth token not found. Run: npx netlify login");
  process.exit(1);
}

const res = await fetch(
  `https://api.netlify.com/api/v1/sites/${siteId}/deploys/${deployId}/restore`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }
);

const text = await res.text();
if (!res.ok) {
  console.error("Restore failed:", res.status, text);
  process.exit(1);
}

console.log("Production updated:", text);
console.log("Live URL: https://1000-l7in.netlify.app");