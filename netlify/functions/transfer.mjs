import { Buffer } from "node:buffer";
import { jsonResponse, corsPreflight, visitorXaiKey } from "./_lib.mjs";
import {
  TAB_BOX,
  decodeDataUrl,
  describeSavedPhone,
  isLocalCaption,
  loadIndex,
  phoneStore,
  savePhoneImage,
  toListItem,
} from "./_transfer-store.mjs";

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

function routeName(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "");
  if (path.endsWith("/upload") || path.includes("/transfer/upload")) return "upload";
  if (path.includes("/describe") || path.includes("/reanalyze")) return "describe";
  if (path.endsWith("/file") || path.includes("/transfer/file")) return "file";
  if (path.endsWith("/list") || path.includes("/transfer/list")) return "list";
  if (path.includes("/catalog")) return "catalog";
  if (path.includes("/spell-assets")) return "spell-assets";
  if (path.includes("/status")) return "status";
  return "";
}

function wantsForce(body) {
  return !!(body && (body.force === true || body.force === "true" || body.force === 1));
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  let force = false;
  try {
    const url = new URL(request.url);
    const route = routeName(url.pathname);
    const store = phoneStore();

    if (route === "file") {
      const id = String(url.searchParams.get("id") || "").replace(/[^A-Za-z0-9._-]/g, "");
      if (!id) return noStore({ ok: false, error: "id required" }, 400);
      const meta = await store.getWithMetadata("file/" + id, { type: "arrayBuffer" });
      if (!meta || !meta.data) return noStore({ ok: false, error: "Not found" }, 404);
      const type =
        (meta.metadata && (meta.metadata.contentType || meta.metadata.contenttype)) || "image/jpeg";
      return new Response(meta.data, {
        status: 200,
        headers: {
          "Content-Type": String(type),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (route === "status" || (route === "" && request.method === "GET")) {
      const items = await loadIndex(store);
      const origin = url.origin || "https://logan7in.art";
      return noStore({
        ok: true,
        public: true,
        phoneUploadsDir: "phone-uploads",
        phoneUploadsCount: items.length,
        toPhoneCount: 0,
        lanUrls: [origin],
        bestLanUrl: origin,
      });
    }

    if (route === "list" || route === "catalog" || route === "spell-assets") {
      const coll = String(url.searchParams.get("collection") || url.searchParams.get("box") || TAB_BOX)
        .toLowerCase()
        .replace(/_/g, "-");
      if (route === "catalog" && coll && coll !== TAB_BOX && coll !== "phone" && coll !== "from-phone") {
        return noStore({ ok: false, error: "static-catalog" }, 404);
      }
      const items = (await loadIndex(store)).map(toListItem);
      if (route === "spell-assets") {
        return noStore({
          ok: true,
          items: items.map((it, i) => ({
            number: 900000 + i,
            url: it.url,
            source: "phone-upload",
            title: it.title,
            name: it.name,
            analysis: it.analysis,
          })),
        });
      }
      return noStore({ ok: true, box: TAB_BOX, items, count: items.length });
    }

    if (request.method === "POST" && (route === "describe" || route === "upload" || route === "")) {
      const ctype = String(request.headers.get("content-type") || "").toLowerCase();
      if (ctype.includes("json") || route === "describe") {
        const body = JSON.parse((await request.text()) || "{}");
        force = wantsForce(body);
        const visitorKey = visitorXaiKey(request);
        const id = String(body.id || "").trim();
        if (id && !body.image_base64 && !body.data && !body.image) {
          const row = await describeSavedPhone(store, id, { force, visitorKey });
          const analysis = row.analysis || null;
          if (force && isLocalCaption(analysis)) {
            return noStore({ ok: false, error: "The description could not be written.", id }, 502);
          }
          return noStore({
            ok: true,
            id: row.id,
            item: toListItem(row),
            analysis,
            description: row.description || "",
            title: row.title || "",
            prompt: row.prompt || "",
          });
        }
        const decoded = decodeDataUrl(body.image_base64 || body.data || body.image || "");
        if (!decoded) return noStore({ ok: false, error: "Provide a photo" }, 400);
        const result = await savePhoneImage(
          store,
          decoded.buf,
          decoded.mime,
          body.name || body.filename || "upload.jpg",
          { force, visitorKey }
        );
        if (result && result.ok === false) {
          return noStore(
            {
              ok: false,
              error: "The description could not be written.",
              id: result.id || "",
              url: result.url || "",
            },
            502
          );
        }
        return noStore(result);
      }
      const buf = Buffer.from(await request.arrayBuffer());
      let name = request.headers.get("x-file-name") || "upload.jpg";
      try {
        name = decodeURIComponent(name);
      } catch (e) {}
      const result = await savePhoneImage(store, buf, ctype.split(";")[0], name);
      return noStore(result);
    }

    return noStore({ ok: false, error: "Not found" }, 404);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (force && status >= 500) {
      return noStore({ ok: false, error: "The description could not be written." }, 502);
    }
    return noStore({ ok: false, error: (err && err.message) || "Upload failed" }, status);
  }
}
