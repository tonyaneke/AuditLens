"use client";

/* The building blocks of a finding's detail page: the hero, the meta strip, the prose sections
   and the attachment list.
 *
 * Extracted 2026-08-06 because the two pages that render a finding had drifted. ObsDetailPage
 * used these shapes (.obs-detail-hero / .obs-detail-meta / .obs-detail-section); the external
 * register's page had been hand-rolled from inline styles inside a plain .card, so the same kind
 * of record looked like a different application depending on which register it came from — its
 * labels were plain <div class="ttl">, its meta strip was an auto-fit grid with no separators,
 * and it had no hero at all.
 *
 * ObsRemediation already carries a note about exactly this failure mode: legacy called one
 * function from both renderObservation and renderExtFinding, and porting it twice is how the two
 * diverged. These are that note's other half — shared for the same reason, so a change to how a
 * finding reads happens once.
 */

import type { ReactNode } from "react";
import RichText from "@/components/ui/RichText";
import type { EvidenceFile } from "@/lib/workspace/types";

/** The badge row + title that opens a detail page. */
export function DetailHero({
  badges,
  title,
  className,
}: {
  badges: ReactNode;
  title: string;
  /** Extra classes for the page root (e.g. the new-observation highlight). */
  className?: string;
}) {
  return (
    <header className={`obs-detail-hero${className ? " " + className : ""}`}>
      <div className="obs-detail-badges">{badges}</div>
      <h2 className="obs-detail-title">{title}</h2>
    </header>
  );
}

/** One cell of the meta strip. Renders nothing when there is no value, so a page can list every
 *  field it might have without each caller repeating the same guard. */
export function Meta({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="obs-meta-item">
      <span className="obs-meta-label">{label}</span>
      <span className="obs-meta-value">{children}</span>
    </div>
  );
}

/** A titled block of prose. Absent when the field is empty — a heading over nothing reads as
 *  missing data rather than as a field that does not apply. */
export function Section({ title, text }: { title: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <section className="obs-detail-section">
      <h4 className="obs-detail-label">{title}</h4>
      <div className="obs-detail-content">
        <RichText text={text} />
      </div>
    </section>
  );
}

/* Supporting documents attached when the finding was raised. Kept out of the remediation
   block on purpose: that block is the conversation, and these are the basis of the finding —
   they belong beside the description an action owner reads first. */
export function Attachments({ files }: { files: EvidenceFile[] | undefined }) {
  if (!files || !files.length) return null;
  return (
    <section className="obs-detail-section">
      <h4 className="obs-detail-label">Supporting documents</h4>
      <div className="obs-detail-content">
        {files.map((e) => (
          <div key={e.itemId} style={{ marginTop: 4 }}>
            📎{" "}
            <a href={`/api/files/${e.itemId}`} target="_blank" rel="noopener noreferrer">
              {e.name}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
