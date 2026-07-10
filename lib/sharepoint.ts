// Microsoft Graph client-credentials access to SharePoint for evidence/SOP uploads.
// Target site: credicorpng.sharepoint.com/auditlens (override via SHAREPOINT_SITE / SHAREPOINT_SITE_PATH).
// Requires AZURE_AD_TENANT_ID / AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET and the app
// registration to have Microsoft Graph **Sites.ReadWrite.All** (application) with admin consent.

const GRAPH = "https://graph.microsoft.com/v1.0";

function cfg() {
  return {
    tenant: process.env.AZURE_AD_TENANT_ID?.trim(),
    clientId: process.env.AZURE_AD_CLIENT_ID?.trim(),
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET?.trim(),
    host: process.env.SHAREPOINT_SITE?.trim() || "credicorpng.sharepoint.com",
    sitePath: process.env.SHAREPOINT_SITE_PATH?.trim() || "/sites/auditlens",
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
  if (siteIdCache) return siteIdCache;
  const c = cfg();
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

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|#%]+/g, "_").slice(0, 180) || "file";
}

export type UploadedFile = {
  itemId: string;
  webUrl: string;
  name: string;
  size: number;
};

export async function uploadToSharePoint(opts: {
  obsId: string;
  fileName: string;
  contentType: string;
  data: ArrayBuffer;
}): Promise<UploadedFile> {
  const token = await getToken();
  const siteId = await getSiteId(token);
  const path = `AuditLens/${safeName(opts.obsId)}/${Date.now()}-${safeName(opts.fileName)}`;
  const res = await fetch(
    `${GRAPH}/sites/${siteId}/drive/root:/${encodeURI(path)}:/content`,
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
  const json = (await res.json()) as { id: string; webUrl: string; name: string; size: number };
  return { itemId: json.id, webUrl: json.webUrl, name: json.name, size: json.size };
}

export async function downloadFromSharePoint(itemId: string): Promise<{
  stream: ReadableStream<Uint8Array> | null;
  contentType: string;
  name: string;
}> {
  const token = await getToken();
  const siteId = await getSiteId(token);
  const metaRes = await fetch(`${GRAPH}/sites/${siteId}/drive/items/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Graph item metadata ${metaRes.status}`);
  const meta = (await metaRes.json()) as { name: string; file?: { mimeType?: string } };
  const contentRes = await fetch(`${GRAPH}/sites/${siteId}/drive/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!contentRes.ok) throw new Error(`Graph item content ${contentRes.status}`);
  return {
    stream: contentRes.body,
    contentType: meta.file?.mimeType || "application/octet-stream",
    name: meta.name,
  };
}
