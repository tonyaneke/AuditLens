"use client";

/* The Assessment tab's "Overall conclusion" — AI-generated and read-only. Shown as paragraphs:
   the overall position, then Key strengths, Priority improvement areas and External quality
   assessment under light headings. Assessments concluded before this view keep their plain
   text, shown as paragraphs. */

import { Fragment, type ReactNode } from "react";
import { conclusionIsStale, conclusionSections } from "@/lib/workspace/iasa";
import { fmtDate } from "@/lib/workspace/selectors";
import type { IaSaRecord } from "@/lib/workspace/types";

/** Render **key phrase** markers as emphasis. React escapes the text, so nothing else can inject. */
function rich(text: string): ReactNode {
  const parts = String(text || "").split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>));
}

export default function Conclusion({ rec }: { rec: IaSaRecord }) {
  const c = rec.conclusion;

  if (!c) {
    const legacy = String(rec.commentary || "").trim();
    if (!legacy) {
      return (
        <div className="iasa-concl-empty">
          No conclusion yet. Click Generate conclusion to have the AI draft it from the ratings,
          evidence and gaps recorded above.
        </div>
      );
    }
    return (
      <div className="iasa-concl">
        {legacy.split(/\n\s*\n/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    );
  }

  return (
    <div className="iasa-concl">
      {conclusionSections(c).map((s, i) => (
        <Fragment key={i}>
          {s.heading ? <h4>{s.heading}</h4> : null}
          <p>{rich(s.text)}</p>
        </Fragment>
      ))}
      <div className="iasa-concl-foot">
        Generated {fmtDate(new Date(c.generatedAt))}
        {conclusionIsStale(rec) ? (
          <span className="iasa-concl-stale">
            {" · Ratings have changed since — regenerate to bring it up to date."}
          </span>
        ) : null}
      </div>
    </div>
  );
}
