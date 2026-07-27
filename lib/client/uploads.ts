"use client";

// Upload with live progress (port of legacy uploadWithProgress). XMLHttpRequest because
// fetch() cannot report upload progress.

export function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress?: (pct: number | null, loaded: number, total: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (onProgress) {
        const pct = e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null;
        onProgress(pct, e.loaded, e.total);
      }
    };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(String(data.error || `Upload failed (${xhr.status}).`)));
    };
    xhr.onerror = () => reject(new Error("Upload failed (network)."));
    xhr.send(formData);
  });
}
