"use client";

/* Evidence upload.
 *
 * Two paths, chosen by size:
 *
 *   small  → one POST of multipart form data to /api/files, as it always was.
 *   large  → open a Graph upload session via /api/files/session, then PUT the file to
 *            /api/files/chunk in slices the server relays onward.
 *
 * The split exists because the host in front of this app refuses a serverless request body over
 * ~4.5 MB, and refuses it BEFORE the route runs — so no server-side limit could have raised it.
 * That is what produced the bare "Upload failed (413)" with no explanation: the response was the
 * platform's, not ours. Slicing below that ceiling is the only way a 25 MB working paper reaches
 * SharePoint, short of letting the browser talk to graph.microsoft.com directly (which would mean
 * loosening `connect-src 'self'` in the CSP and handing a pre-authorised upload URL to the page).
 *
 * XMLHttpRequest rather than fetch() throughout: fetch cannot report upload progress.
 */

/** Anything at or above this is chunked. Comfortably under the ~4.5 MB platform limit. */
const CHUNKED_ABOVE = 3 * 1024 * 1024;

export type UploadProgress = (pct: number | null, loaded: number, total: number) => void;

function explain(status: number, body: Record<string, unknown>): string {
  if (body.error) return String(body.error);
  /* A 413 whose body is not our JSON never reached the route — it was refused by the host in
     front of it. "Upload failed (413)" sent people hunting through app code for a limit that is
     not there, so name the real cause. */
  if (status === 413)
    return "The file was rejected as too large before it reached AuditLens — the hosting platform caps request size. This should not happen for files under the stated limit; please report it.";
  return `Upload failed (${status}).`;
}

/** One XHR, resolved with the parsed JSON body. */
function send(
  method: "POST" | "PUT",
  url: string,
  body: XMLHttpRequestBodyInit,
  opts?: { headers?: Record<string, string>; onProgress?: (loaded: number, total: number) => void },
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(opts?.headers || {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (opts?.onProgress && e.lengthComputable) opts.onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* platform error pages are not JSON — explain() handles that */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(explain(xhr.status, data)));
    };
    xhr.onerror = () => reject(new Error("Upload failed (network)."));
    xhr.send(body);
  });
}

/** Legacy single-request upload. Kept for small files and for any caller that already has a
 *  FormData in hand. */
export function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress?: UploadProgress,
): Promise<Record<string, unknown>> {
  return send("POST", url, formData, {
    onProgress: (loaded, total) => onProgress?.(Math.round((loaded / total) * 100), loaded, total),
  });
}

/** Chunked upload. Progress is reported across the whole file, not per chunk, so the bar moves
 *  once from 0 to 100 rather than resetting on every slice. */
async function uploadChunked(
  obsId: string,
  file: File,
  onProgress?: UploadProgress,
): Promise<Record<string, unknown>> {
  const started = await send(
    "POST",
    "/api/files/session",
    JSON.stringify({ obsId, fileName: file.name, size: file.size }),
    { headers: { "Content-Type": "application/json" } },
  );
  const token = String(started.token || "");
  const chunkSize = Number(started.chunkSize) || CHUNKED_ABOVE;
  if (!token) throw new Error("Could not start the upload.");

  const total = file.size;
  let sent = 0;
  let result: Record<string, unknown> | null = null;

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total);
    const base = sent;
    const res = await send("PUT", "/api/files/chunk", file.slice(start, end), {
      headers: {
        "Content-Type": "application/octet-stream",
        "x-upload-token": token,
        "x-chunk-start": String(start),
        "x-chunk-total": String(total),
      },
      onProgress: (loaded) => {
        const done = Math.min(base + loaded, total);
        onProgress?.(Math.round((done / total) * 100), done, total);
      },
    });
    sent = end;
    onProgress?.(Math.round((sent / total) * 100), sent, total);
    if (res.done) result = res;
  }

  if (!result) throw new Error("The upload finished but SharePoint returned no file.");
  return result;
}

/** The entry point every attachment surface should use — picks the right path for the size. */
export function uploadFile(
  obsId: string,
  file: File,
  onProgress?: UploadProgress,
): Promise<Record<string, unknown>> {
  if (file.size >= CHUNKED_ABOVE) return uploadChunked(obsId, file, onProgress);
  const fd = new FormData();
  fd.append("file", file);
  fd.append("obsId", obsId);
  return uploadWithProgress("/api/files", fd, onProgress);
}
