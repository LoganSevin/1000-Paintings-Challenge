import { jsonResponse, corsPreflight } from "./_lib.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const clientId = String(process.env.GOOGLE_CLIENT_ID || process.env.PULSE_GOOGLE_CLIENT_ID || "").trim();
  const placeholder = !clientId || clientId.startsWith("YOUR_");
  return jsonResponse({
    ok: true,
    google_enabled: !!clientId && !placeholder,
    client_id: placeholder ? "" : clientId,
  });
}
