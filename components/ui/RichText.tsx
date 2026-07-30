"use client";

/* Renders stored audit text AS WRITTEN. URLs become links and stray markdown asterisks are
   removed; nothing else is reformatted.

   This used to turn any multi-line value into an <ol> — one numbered item per line — and strip
   whatever bullet or number the author had put at the start of each line. On a management
   response that is already structured prose with its own headings and sub-points, that produced
   a flat numbered list that bore no relation to what was typed: every heading, every sub-bullet
   and every ordinary sentence came out as a sibling numbered item, and the author's own
   numbering was deleted.

   These are contractual management responses and auditor notes quoted in Board papers. The
   application must not restructure them — it must show what the author wrote. Whitespace is
   preserved with white-space: pre-wrap, so line breaks, blank lines, indentation and the
   author's own bullets all survive exactly as entered. */

import { Fragment, type ReactNode } from "react";

function stripMd(s: unknown): string {
  return String(s == null ? "" : s).replace(/\*/g, "");
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;

export function linkifyText(s: string): ReactNode {
  const parts = stripMd(s).split(URL_RE);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noopener" className="rt-link">
        {p}
      </a>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

export default function RichText({ text }: { text: unknown }) {
  if (text == null || text === "") return null;
  const s = stripMd(String(text).trim());
  if (!s) return null;
  return <span className="rt-text">{linkifyText(s)}</span>;
}
