"use client";

/* Evidence-attachment primitives shared by every observation dialog.

   uploadEvidence/FilePick lived inside workflow-dialogs.tsx, which meant the only surfaces that
   could attach a file were the ones in that module — the owner's Ready-for-Closure response and
   the auditor's closure note. Internal Audit had no way to attach supporting documents to an
   observation they had just raised. They live here so ObsCommentDialog can reuse them without
   pulling in the whole workflow-dialog bundle. */

import { useRef, useState } from "react";
import { uploadWithProgress } from "@/lib/client/uploads";
import type { EvidenceFile } from "@/lib/workspace/types";

/** Mirrors MAX_BYTES in app/api/files/route.ts — checked here so an oversized file is refused
 *  before it is pushed over the wire and comes back as an opaque 413. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function tooLarge(files: File[]): File | undefined {
  return files.find((f) => f.size > MAX_UPLOAD_BYTES);
}

export async function uploadEvidence(obsId: string, file: File | undefined): Promise<EvidenceFile | null> {
  if (!file) return null;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("obsId", obsId);
  const data = await uploadWithProgress("/api/files", fd);
  return (data.file as EvidenceFile) || null;
}

/** Upload several files in sequence. Sequential rather than parallel: SharePoint is the bottleneck
 *  and a partial failure is easier to report when it is the first one that failed. */
export async function uploadAllEvidence(obsId: string, files: File[]): Promise<EvidenceFile[]> {
  const out: EvidenceFile[] = [];
  for (const f of files) {
    const ev = await uploadEvidence(obsId, f);
    if (ev) out.push(ev);
  }
  return out;
}

/* ---- single-file picker (Ready for Closure, closure note) ---- */

export function FilePick({ onPick, label = "📎 Attach file" }: { onPick: (f: File | undefined) => void; label?: string }) {
  const [name, setName] = useState("");
  return (
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <label className="btn sec sm" style={{ display: "inline-block", margin: 0 }}>
        {label}
        <input
          type="file"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            setName(f?.name || "");
            onPick(f);
          }}
        />
      </label>
      <span className="hint">{name || "No file chosen (optional)"}</span>
    </div>
  );
}

/* ---- multi-file picker (auditor comments) ----
   Supporting documents for an observation rarely come one at a time — the working paper, the
   extract and the policy page are one attachment set. Picks accumulate rather than replace, and
   each can be removed, so choosing the wrong file does not mean starting the selection over. */

export function FilePickMulti({
  files,
  onChange,
  label = "📎 Attach files",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="btn sec sm" style={{ display: "inline-block", margin: 0 }}>
          {label}
          <input
            type="file"
            multiple
            ref={ref}
            style={{ display: "none" }}
            onChange={(e) => {
              const picked = Array.from(e.target.files || []);
              if (picked.length) onChange([...files, ...picked]);
              // Clearing the input is what lets the same file be re-picked after a remove.
              if (ref.current) ref.current.value = "";
            }}
          />
        </label>
        <span className="hint">
          {files.length ? `${files.length} file${files.length === 1 ? "" : "s"} attached` : "No files chosen (optional)"}
        </span>
      </div>
      {files.length ? (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 4 }}>
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="hint"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span style={{ flex: 1, wordBreak: "break-all" }}>📎 {f.name}</span>
              <button
                type="button"
                className="btn ghost sm"
                title={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                ×<span className="visually-hidden"> remove {f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
