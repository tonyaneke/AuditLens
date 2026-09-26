"use client";

/* A report's status — Draft · Under Review · Final (the options in the report dialog). It used to
   borrow the criticality pills with a `c-Medium` class that does not exist, so every status but
   Final rendered as bare text. */

const REPORT_STATUS_CLASS: Record<string, string> = {
  Draft: "draft",
  "Under Review": "progress",
  Final: "closed",
};

export default function ReportStatusPill({ status }: { status: string | undefined }) {
  const s = status || "Draft";
  return (
    <span className={`status-pill ${REPORT_STATUS_CLASS[s] || "draft"}`} style={{ flexShrink: 0 }}>
      {s}
    </span>
  );
}
