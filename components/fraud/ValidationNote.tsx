// Evidence on a fraud prevention action — the owner's implementation evidence and Internal
// Audit's validation note and working papers — shown on the register, the risk detail page and in
// the action owner's portal, so both sides see the same record.

import { FRAUD_VALIDATED, fraudOwnerEvidence } from "@/lib/workspace/fraud";
import { fmtDateTime } from "@/lib/workspace/selectors";
import type { EvidenceFile, FraudAction } from "@/lib/workspace/types";

/** Links to attached files; downloads stream through /api/files like every other evidence. */
export function EvidenceLinks({ files, label }: { files: EvidenceFile[] | undefined; label?: string }) {
  if (!files || !files.length) return null;
  return (
    <div className="fraud-evidence">
      {label ? <span className="fraud-evidence-label">{label}</span> : null}
      {files.map((e) => (
        <a key={e.itemId} href={`/api/files/${e.itemId}`} target="_blank" rel="noopener noreferrer">
          📎 {e.name}
        </a>
      ))}
    </div>
  );
}

/** Everything the owner has attached across their updates. */
export function FraudOwnerEvidence({ a }: { a: FraudAction }) {
  return <EvidenceLinks files={fraudOwnerEvidence(a)} label="Owner's evidence:" />;
}

export function FraudValidationNote({ a }: { a: FraudAction }) {
  if (a.status !== FRAUD_VALIDATED || !a.validationNote) return null;
  const meta = [a.validatedByName, fmtDateTime(a.validatedAt)].filter(Boolean).join(" · ");
  return (
    <div className="fraud-validation">
      <b>Validated by Internal Audit:</b> {a.validationNote}
      <EvidenceLinks files={a.validationEvidence} />
      {meta ? <span className="fraud-validation-meta">{meta}</span> : null}
    </div>
  );
}
