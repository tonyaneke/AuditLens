// Microsoft Graph client-credentials access to SharePoint for evidence/SOP uploads.
// Target site: credicorpng.sharepoint.com/auditlens (override via SHAREPOINT_SITE / SHAREPOINT_SITE_PATH).
// Requires AZURE_AD_TENANT_ID / AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET and the app
// registration to have Microsoft Graph **Sites.ReadWrite.All** (application) with admin consent.

const GRAPH = "https://graph.microsoft.com/v1.0";

// Trim whitespace and strip a single pair of surrounding quotes so quoted .env values
// (e.g. AZURE_AD_TENANT_ID="<guid>") don't leak quote characters into request URLs.
function cleanEnv(v?: string): string | undefined {
  if (v == null) return v;
  let s = v.trim();
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function cfg() {
  return {
    tenant: cleanEnv(process.env.AZURE_AD_TENANT_ID),
    clientId: cleanEnv(process.env.AZURE_AD_CLIENT_ID),
    clientSecret: cleanEnv(process.env.AZURE_AD_CLIENT_SECRET),
    host: cleanEnv(process.env.SHAREPOINT_SITE) || "credicorpng.sharepoint.com",
    sitePath: cleanEnv(process.env.SHAREPOINT_SITE_PATH) || "/sites/auditlens",
    // Optional pins — skip the site/drive lookups when provided.
    siteId: cleanEnv(process.env.SHAREPOINT_SITE_ID),
    driveId: cleanEnv(process.env.SHAREPOINT_DRIVE_ID),
  };
}

export function sharepointConfigured(): boolean {
  const c = cfg();
  return !!(c.tenant && c.clientId && c.clientSecret);
}

let tokenCache: { token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  const c = cfg();
  if (!c.tenant || !c.clientId || !c.clientSecret) {
    throw new Error("SharePoint (Azure AD) is not configured.");
  }
  const now = Date.now();
  if (tokenCache && tokenCache.exp > now + 60_000) return tokenCache.token;

  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Azure token error ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache = { token: json.access_token, exp: now + (json.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

let siteIdCache: string | null = null;

async function getSiteId(token: string): Promise<string> {
  const c = cfg();
  if (c.siteId) return c.siteId;
  if (siteIdCache) return siteIdCache;
  const res = await fetch(`${GRAPH}/sites/${c.host}:${c.sitePath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Graph site lookup ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id: string };
  siteIdCache = json.id;
  return json.id;
}

// The Graph path segment for the target document library — a pinned drive if
// configured, else the site's default drive.
async function driveBase(token: string): Promise<string> {
  const c = cfg();
  if (c.driveId) return `/drives/${c.driveId}`;
  return `/sites/${await getSiteId(token)}/drive`;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|#%]+/g, "_").slice(0, 180) || "file";
}

/** Where an observation's attachments live in the library. Timestamped so re-uploading a file of
 *  the same name keeps both rather than silently replacing the earlier evidence. */
function uploadPath(obsId: string, fileName: string): string {
  return `AuditLens/${safeName(obsId)}/${Date.now()}-${safeName(fileName)}`;
}

export type UploadedFile = {
  itemId: string;
  webUrl: string;
  name: string;
  size: number;
};

type DriveItem = { id: string; webUrl: string; name: string; size: number };

/* Graph's simple upload (`PUT .../content`) is capped by Microsoft at 4 MB — a 5 MB working paper
   came back as a Graph 413 no matter what our own limit said. Anything at or above this goes
   through an upload session instead. */
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;

/* Graph requires every chunk except the last to be a multiple of 320 KiB. 10 MiB is Microsoft's
   recommended size and is exactly 32 × 320 KiB. This is the server→Graph hop, so it is bounded by
   Graph's rules alone, not by whatever limit sits in front of our own API. */
const CHUNK_BYTES = 10 * 1024 * 1024;

/** Open a Graph upload session for an observation attachment and return its (pre-authorised)
 *  upload URL. Used both by the server-side chunker below and by /api/files/session, which hands
 *  a sealed reference to the browser so a large file can be sent in pieces. */
export async function openSharePointUploadSession(opts: {
  obsId: string;
  fileName: string;
}): Promise<string> {
  const token = await getToken();
  const base = await driveBase(token);
  return createUploadSession(token, base, uploadPath(opts.obsId, opts.fileName));
}

async function createUploadSession(token: string, base: string, path: string): Promise<string> {
  const res = await fetch(`${GRAPH}${base}/root:/${encodeURI(path)}:/createUploadSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // The path is uniquified with a timestamp, so a collision means a retry of the same upload.
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Graph upload session ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { uploadUrl?: string };
  if (!json.uploadUrl) throw new Error("Graph upload session returned no uploadUrl.");
  return json.uploadUrl;
}

/** Relay one ordered slice into an upload session. The session URL is pre-authorised — Microsoft
 *  explicitly says NOT to send the Authorization header with it.
 *
 *  Returns the created DriveItem on the slice that completes the file, and null while Graph is
 *  still expecting more (202). */
export async function putUploadChunk(
  uploadUrl: string,
  chunk: ArrayBuffer,
  start: number,
  total: number,
): Promise<UploadedFile | null> {
  const end = start + chunk.byteLength - 1;
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Range": `bytes ${start}-${end}/${total}` },
    body: chunk,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    // Abandon the session so a failed upload doesn't hold the name for the next attempt.
    await fetch(uploadUrl, { method: "DELETE" }).catch(() => {});
    throw new Error(`Graph chunk ${start}-${end} failed ${res.status}: ${t.slice(0, 200)}`);
  }
  // 202 = accepted, more chunks expected. 200/201 = complete, and the body is the DriveItem.
  if (res.status === 200 || res.status === 201) {
    const item = (await res.json()) as DriveItem;
    return { itemId: item.id, webUrl: item.webUrl, name: item.name, size: item.size };
  }
  await res.text().catch(() => "");
  return null;
}

/** Server-side chunker for a file this process already holds whole (the small/simple path). */
async function uploadInChunks(uploadUrl: string, data: ArrayBuffer): Promise<UploadedFile> {
  const total = data.byteLength;
  let start = 0;
  let item: UploadedFile | null = null;
  while (start < total) {
    const end = Math.min(start + CHUNK_BYTES, total);
    item = (await putUploadChunk(uploadUrl, data.slice(start, end), start, total)) || item;
    start = end;
  }
  if (!item) throw new Error("Graph upload finished without returning the created file.");
  return item;
}

export async function uploadToSharePoint(opts: {
  obsId: string;
  fileName: string;
  contentType: string;
  data: ArrayBuffer;
}): Promise<UploadedFile> {
  const token = await getToken();
  const base = await driveBase(token);
  const path = uploadPath(opts.obsId, opts.fileName);

  if (opts.data.byteLength >= SIMPLE_UPLOAD_MAX) {
    const uploadUrl = await createUploadSession(token, base, path);
    return uploadInChunks(uploadUrl, opts.data);
  }

  const res = await fetch(
    `${GRAPH}${base}/root:/${encodeURI(path)}:/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": opts.contentType || "application/octet-stream",
      },
      body: opts.data,
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Graph upload ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as DriveItem;
  return { itemId: json.id, webUrl: json.webUrl, name: json.name, size: json.size };
}

export async function downloadFromSharePoint(itemId: string): Promise<{
  stream: ReadableStream<Uint8Array> | null;
  contentType: string;
  name: string;
}> {
  const token = await getToken();
  const base = await driveBase(token);
  const metaRes = await fetch(`${GRAPH}${base}/items/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Graph item metadata ${metaRes.status}`);
  const meta = (await metaRes.json()) as { name: string; file?: { mimeType?: string } };
  const contentRes = await fetch(`${GRAPH}${base}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!contentRes.ok) throw new Error(`Graph item content ${contentRes.status}`);
  return {
    stream: contentRes.body,
    contentType: meta.file?.mimeType || "application/octet-stream",
    name: meta.name,
  };
}
