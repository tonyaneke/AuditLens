"use client";

// "How to use AuditLens" — React port of the legacy viewGuide().

import { usePageChrome } from "@/components/chrome/PageChrome";
import { CritPill } from "@/components/ui";
import { CRITS, RUBRIC } from "@/lib/workspace/selectors";

export default function GuidePage() {
  usePageChrome({ title: "How to use AuditLens" });

  return (
    <>
      <div className="card">
        <h3>The 4-step loop</h3>
        <ol style={{ lineHeight: 1.9, paddingLeft: 18 }}>
          <li>
            <b>Set up structure once.</b> In <b>Audits &amp; Reports</b>, create an audit (by
            process or department). Add one or more reports under it.
          </li>
          <li>
            <b>Plan the audit.</b> Open the audit and build a scope, objectives, key risks and
            test programme you can edit and export to Word.
          </li>
          <li>
            <b>Add observations.</b> On the <b>Dashboard</b>, click <b>+ New Observation</b>, or
            add them directly from a report.
          </li>
          <li>
            <b>Review &amp; edit.</b> Edit criticality, owner, management response, proposed SOP
            updates, and closure details as needed.
          </li>
          <li>
            <b>Report &amp; brief.</b> Each report builds an <b>Executive Summary</b>; the{" "}
            <b>CAE/MD Dashboard</b> rolls everything up. Export any report or the whole audit to{" "}
            <b>Word</b>.
          </li>
        </ol>
      </div>

      <div className="card">
        <h3>Putting a report on your CREDICORP letterhead</h3>
        <ol style={{ lineHeight: 1.9, paddingLeft: 18 }}>
          <li>
            Open your master template (e.g. <i>INTERNAL AUDIT REPORT - CREDIT PORTFOLIO.docx</i>)
            and <b>Save As</b> a new file name.
          </li>
          <li>
            Delete the old body <b>below the cover page and Table of Contents</b> — keep the
            cover, the TOC, and the headers/footers (those carry the logo).
          </li>
          <li>
            In a report here, click <b>⤓ Export report (Word)</b>, open it,{" "}
            <b>select all → copy</b>, and <b>paste</b> into your template under the TOC.
            Headings, colour-coded ratings and the findings table come across.
          </li>
          <li>
            Click the Table of Contents → press <b>F9</b> → <b>Update entire table</b>. Done.
          </li>
        </ol>
      </div>

      <div className="card">
        <h3>Criticality rubric (Risk Classification Guide)</h3>
        {CRITS.map((c) => (
          <div className="kv" key={c}>
            <b>
              <CritPill crit={c} />
            </b>{" "}
            {RUBRIC[c]}
          </div>
        ))}
      </div>
    </>
  );
}
