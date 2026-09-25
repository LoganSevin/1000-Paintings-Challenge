import { jsonResponse, corsPreflight } from "./_lib.mjs";

function dollarsFromCents(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n > 1000 ? n / 100 : n;
}

async function fetchVendor() {
  const mgmt = String(process.env.XAI_MANAGEMENT_KEY || "").trim();
  const team = String(process.env.XAI_TEAM_ID || "").trim();
  if (!mgmt || !team) {
    return {
      vendor_ok: false,
      vendor_error: mgmt ? "missing_team_id" : "missing_management_key",
      message: mgmt
        ? "Set XAI_TEAM_ID on Netlify to read prepaid balance."
        : "Set XAI_MANAGEMENT_KEY on Netlify (console.x.ai → Management Keys) to read prepaid. Studio meter stays live either way.",
    };
  }
  const headers = {
    Authorization: "Bearer " + mgmt,
    Accept: "application/json",
  };
  try {
    const balRes = await fetch("https://api.x.ai/v1/management/teams/" + team + "/prepaid-credits", {
      headers,
    });
    const bal = await balRes.json().catch(function () {
      return {};
    });
    const credits = dollarsFromCents(bal.total ?? bal.balance ?? bal.credits);
    return {
      vendor_ok: balRes.ok,
      credits_usd: credits,
      week_spent_usd: null,
      week_remaining_usd: credits,
      week_limit_usd: credits,
      team_id: team,
      message: balRes.ok ? "" : String(bal.error || bal.message || "Management API " + balRes.status),
    };
  } catch (err) {
    return {
      vendor_ok: false,
      vendor_error: "fetch_failed",
      message: String((err && err.message) || err).slice(0, 400),
    };
  }
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const vendor = await fetchVendor();
  return jsonResponse({
    ok: true,
    studio: true,
    vendor_ok: !!vendor.vendor_ok,
    credits_usd: vendor.credits_usd ?? null,
    week_spent_usd: vendor.week_spent_usd ?? null,
    week_remaining_usd: vendor.week_remaining_usd ?? null,
    week_limit_usd: vendor.week_limit_usd ?? null,
    team_id: vendor.team_id || "",
    console_url: "https://console.x.ai/team/default/billing",
    mgmt_keys_url: "https://console.x.ai/team/default/management-keys",
    message: vendor.message || "",
    fetched_at: Date.now(),
  });
}
