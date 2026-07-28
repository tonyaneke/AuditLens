"use client";

// Port of resultPill(r) from audit-bot.js — Passed→c-Low, Exception→c-Critical,
// Partial→c-Moderate, anything else renders as a plain tag.

const RESULT_PILL_CLASS: Record<string, string> = {
  Passed: "c-Low",
  Exception: "c-Critical",
  Partial: "c-Moderate",
};

export default function ResultPill({ result }: { result: string | undefined }) {
  const r = result || "Not Tested";
  const cls = RESULT_PILL_CLASS[r];
  return cls ? <span className={`pill ${cls}`}>{r}</span> : <span className="tag">{r}</span>;
}
