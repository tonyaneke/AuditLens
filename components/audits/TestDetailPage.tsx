"use client";

/* Test programme detail (/audits/[audit]/tests/[test]) — one test from an audit plan, read the way
   an observation is read: hero, meta strip, prose sections, evidence, then every observation that
   was raised from it. The plan table on the audit page stays a one-line-per-test index; the full
   "what was found" narrative lives here, where it has room. */

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useModal } from "@/components/modals/ModalProvider";
import { BackButton } from "@/components/ui";
import {
  obsRaisedFromTest,
  testControl,
  testEvidence,
  testIsException,
  testResultNotes,
  testTitle,
} from "@/lib/workspace/observations";
import type { AuditPlan } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { Attachments, DetailHero, Meta, Section } from "./detail-parts";
import { ModalRaiseExceptionDialog, ModalTestDialog } from "./lazy";
import ObsGridCard from "./ObsGridCard";
import RaisedPill from "./RaisedPill";
import ResultPill from "./ResultPill";

export default function TestDetailPage({ auditId, testId }: { auditId: string; testId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();

  const a = (db.audits || []).find((x) => x.id === auditId);
  const t = a && ((a.plan || {}) as AuditPlan).tests?.find((x) => x.id === testId);
  const auditHref = a ? `/audits/${a.id}` : "/audits";
  const raised = a && t ? obsRaisedFromTest(a, t.id) : [];

  function delTest() {
    if (!a || !t) return;
    modal.confirm({
      message: "Delete this test?",
      danger: true,
      confirmLabel: "Delete",
      onConfirm: () => {
        mutate((d) => {
          const cur = (d.audits || []).find((x) => x.id === auditId);
          const p = cur && (cur.plan as AuditPlan | undefined);
          if (!p || !p.tests) return;
          p.tests = p.tests.filter((x) => x.id !== testId);
        });
        router.push(auditHref);
      },
    });
  }

  usePageChrome(
    {
      title: "",
      back: <BackButton href={auditHref} />,
      actions:
        a && t ? (
          <div className="topbar-actions">
            {testIsException(t) ? (
              <button
                className="btn sm"
                type="button"
                style={{ background: "var(--crit)" }}
                onClick={() => modal.open(<ModalRaiseExceptionDialog auditId={a.id} testId={t.id} />)}
              >
                ⚑ {raised.length ? "Raise another" : "Raise"}
              </button>
            ) : null}
            <button className="btn sec sm" type="button" onClick={() => modal.open(<ModalTestDialog auditId={a.id} testId={t.id} />)}>
              Edit
            </button>
            <button className="btn ghost sm danger" type="button" onClick={delTest}>
              Delete
            </button>
          </div>
        ) : null,
    },
    // The actions depend on the test's result and on whether it has been raised, so the topbar
    // has to refresh when either changes — the title alone never does here.
    [t?.result, raised.length, !!t],
  );

  if (!a || !t) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <h3>Test not found</h3>
        <p className="hint">This test may have been deleted from the audit plan.</p>
        <Link href={auditHref} className="btn sec" style={{ marginTop: 16 }}>
          ← Back to audit
        </Link>
      </div>
    );
  }

  const population = [t.population, t.sampleBasis].filter(Boolean).join(" · ");

  return (
    <div className="obs-detail-page anim-fade-in">
      <DetailHero
        title={(t.ref ? t.ref + " — " : "") + testTitle(t)}
        badges={
          <>
            <ResultPill result={t.result} />
            {raised.length ? <RaisedPill count={raised.length} /> : null}
            <span className="tag">Test programme</span>
          </>
        }
      />

      <div className="obs-detail-meta">
        <Meta label="Audit">
          <Link href={auditHref}>{a.name}</Link>
        </Meta>
        <Meta label="Tested by">{t.testedBy || ""}</Meta>
        <Meta label="Test date">{t.testedDate || ""}</Meta>
        <Meta label="Working paper">{t.evidenceRef || ""}</Meta>
      </div>

      <div className="obs-detail-sections">
        <Section title="Objective" text={t.objective} />
        <Section title="Procedure" text={t.procedure} />
        <Section title="Control / assertion tested" text={testControl(t)} />
        <Section title="Population / sample" text={population} />
        <Section title="What was found" text={testResultNotes(t)} />
        <Attachments title="Evidence" files={testEvidence(t)} />
      </div>

      <section className="obs-detail-section" style={{ borderTop: "1px solid var(--line)" }}>
        <h4 className="obs-detail-label">Observations raised from this test ({raised.length})</h4>
        {raised.length ? (
          <div className="obs-grid" style={{ marginTop: 8 }}>
            {raised.map(({ r, o }) => (
              <ObsGridCard key={o.id} a={a} r={r} o={o} />
            ))}
          </div>
        ) : (
          <NoRaisedObs
            result={t.result}
            hasReports={!!(a.reports || []).length}
            auditHref={auditHref}
            onRaise={() => modal.open(<ModalRaiseExceptionDialog auditId={a.id} testId={t.id} />)}
            onRecord={() => modal.open(<ModalTestDialog auditId={a.id} testId={t.id} />)}
          />
        )}
      </section>
    </div>
  );
}

/* What "no observations yet" means depends on the test's result: a raised-able exception, a pass
   with nothing to raise, or fieldwork not done yet. Each state says why the list is empty and, where
   there is one, offers the next step. */
function NoRaisedObs({
  result,
  hasReports,
  auditHref,
  onRaise,
  onRecord,
}: {
  result: string | undefined;
  hasReports: boolean;
  auditHref: string;
  onRaise: () => void;
  onRecord: () => void;
}) {
  const r = result || "Not Tested";
  let icon = "✓";
  let heading = "";
  let body = "";
  let action: ReactNode = null;

  if (r === "Exception" || r === "Partial") {
    const what = r === "Exception" ? "an exception" : "a partial result";
    if (!hasReports) {
      icon = "📄";
      heading = "No report to raise into yet";
      body = `This test recorded ${what}, but the audit has no report to hold an observation. Create a report on the audit page, then raise it here.`;
      action = (
        <Link href={auditHref} className="btn sec sm">
          Go to the audit →
        </Link>
      );
    } else {
      icon = "⚑";
      heading = "Not raised yet";
      body = `This test recorded ${what}. Raise it as an observation so it can be assigned to an owner and tracked. You can draft it with AI or write it yourself.`;
      action = (
        <button className="btn sm" type="button" style={{ background: "var(--crit)" }} onClick={onRaise}>
          ⚑ Raise observation
        </button>
      );
    }
  } else if (r === "Passed") {
    heading = "Nothing to raise";
    body = "This test passed, so no observation is expected from it.";
  } else if (r === "N/A") {
    icon = "—";
    heading = "Not applicable";
    body = "This test was marked N/A, so it produces no observations.";
  } else {
    icon = "◷";
    heading = "Not tested yet";
    body = "Record the fieldwork result first. If testing finds an exception or a partial result, you can raise it here.";
    action = (
      <button className="btn sec sm" type="button" onClick={onRecord}>
        Record result
      </button>
    );
  }

  return (
    <div className="empty test-obs-empty">
      <div className="big" aria-hidden="true">
        {icon}
      </div>
      <div className="test-obs-empty-heading">{heading}</div>
      <p className="test-obs-empty-body">{body}</p>
      {action}
    </div>
  );
}
