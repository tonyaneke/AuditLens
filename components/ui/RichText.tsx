"use client";

// Port of legacy stripMd/linkify/richText: multi-line text renders as a numbered list (one item
// per line, leading bullets/numbers stripped), URLs become links, markdown asterisks removed.

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
  const parts = s
    .split(/\r?\n+/)
    .map((x) => x.replace(/^\s*(?:[-•·▪]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  if (parts.length > 1)
    return (
      <ol className="rt-list">
        {parts.map((l, i) => (
          <li key={i}>{linkifyText(l)}</li>
        ))}
      </ol>
    );
  return <>{linkifyText(s)}</>;
}
