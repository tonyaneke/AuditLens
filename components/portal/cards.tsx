"use client";

// Shared building blocks for the Action-Owner portal list pages — ports of myObsCard(),
// myObsSectionsHTML(), ownerAnnounceHTML()/dismissOwnerAnnounce() and the first-login
// walkthrough (modalOwnerSimulation/showSimStep) from audit-bot.js.

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useUser } from "@/components/chrome/UserContext";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { CritPill, Empty, StatusPill, TintPill } from "@/components/ui";
import { hrefForView, isLegacyPath } from "@/lib/routes";
import { EXT_SEV_HEX, isAssignedTo } from "@/lib/workspace/portal";
import { effectiveClose, fmtDate, type ObsWithContext } from "@/lib/workspace/selectors";
import type { ExtFinding } from "@/lib/workspace/types";

/* ---------------- card list item ---------------- */

export type PortalItem =
  | { o: ObsWithContext; type: "Internal" }
  | { o: ExtFinding; type: "External" };

export function MyObsCard({ item }: { item: PortalItem }) {
  const router = useRouter();
  const user = useUser();
  const ext = item.type === "External";
  const o = item.o;
  /* The portal lists the whole department's observations, so each card has to say whether this is
     yours to answer or a colleague's — without it the list reads as "all of this is on me". */
  const mine = isAssignedTo(o, user.id);

  function open() {
    const href = ext
      ? hrefForView("extfinding", { ext: o.id })
      : hrefForView("observation", {
          audit: (o as ObsWithContext)._a.id,
          report: (o as ObsWithContext)._r.id,
          obs: o.id,
        });
    // Cross-shell navigation must be a full page load (legacy script boots on a fresh document).
    if (isLegacyPath(href)) window.location.assign(href);
    else router.push(href);
  }

  const sv = EXT_SEV_HEX[String((o as ExtFinding).severity || "")] || "#64748b";
  const ctx = ext
    ? `${(o as ExtFinding).source || "—"}${(o as ExtFinding).year ? " · " + (o as ExtFinding).year : ""}`
    : `${(o as ObsWithContext)._a.name}${(o as ObsWithContext)._a.area ? " · " + (o as ObsWithContext)._a.area : ""}`;
  const ecStr = ext
    ? String((o as ExtFinding).dueDate || "")
    : (() => {
        const c = effectiveClose(o as ObsWithContext, (o as ObsWithContext)._r);
        return c ? fmtDate(c) : "";
      })();
  const rfc = !!o.ownerRectifiedAt && (o.status || "Open") !== "Closed";

  return (
    /* QA-6 — was a <div onClick>. This is an action owner's primary route into their own
       observations, so it being keyboard-unreachable locked them out of the portal entirely. */
    <button type="button" className="myobs-card" onClick={open} title="Open">
      <div className="myobs-card-top">
        {ext ? (
          <TintPill hex={sv}>{(o as ExtFinding).severity || "—"}</TintPill>
        ) : (
          <CritPill crit={(o as ObsWithContext).criticality} />
        )}
        <span className="tag">{item.type}</span>
        <StatusPill status={o.status} />
        {rfc ? (
          <span
            className="pill"
            style={{ background: "color-mix(in oklch,var(--low) 16%,#fff)", color: "var(--low)" }}
          >
            Ready for closure
          </span>
        ) : null}
      </div>
      <div className="myobs-card-title">{o.title}</div>
      <div className="myobs-card-meta">
        {ctx}
        {!ext ? (
          <>
            {" · "}
            {mine ? "Assigned to you" : `Owner: ${o.owner || "unassigned"}`}
          </>
        ) : null}
      </div>
      {ecStr ? (
        <div className="myobs-card-foot">
          <span className="hint">Expected close</span>
          <span>{ecStr}</span>
        </div>
      ) : null}
    </button>
  );
}

/* ---------------- open / closed sections (myObsSectionsHTML) ---------------- */

/** One titled, counted grid of portal cards. Split out of MyObsSections so a status-filtered
 *  portal can render a single bucket instead of an Open/Closed pair where one side is always
 *  empty ("Open observations (0)" above the closed ones reads like a bug). */
export function PortalSection({
  title,
  items,
  empty,
}: {
  title: string;
  items: PortalItem[];
  /** What this particular bucket being empty means. Defaults to the neutral wording. */
  empty?: { icon: string; text: ReactNode };
}) {
  return (
    <>
      <div className="seclabel" style={{ margin: "20px 0 12px" }}>
        {title} <span className="hint" style={{ fontWeight: 400 }}>({items.length})</span>
      </div>
      {items.length ? (
        <div className="myobs-grid">
          {items.map((x) => (
            <MyObsCard key={x.o.id} item={x} />
          ))}
        </div>
      ) : (
        /* Was a bare line of grey text, which read as the page having failed to load rather than
           as a section with nothing in it — and an empty "Open observations" is usually good news,
           so it should look deliberate. Same .empty card every other empty list on the site uses. */
        <div className="card">
          <Empty big={empty?.icon || "—"}>{empty?.text || "Nothing here."}</Empty>
        </div>
      )}
    </>
  );
}

export function MyObsSections({
  items,
  labels,
}: {
  items: PortalItem[];
  labels: [string, string];
}) {
  const open = items.filter((x) => (x.o.status || "Open") !== "Closed");
  const closed = items.filter((x) => (x.o.status || "Open") === "Closed");
  return (
    <>
      <PortalSection
        title={labels[0]}
        items={open}
        empty={{
          icon: "✅",
          text: (
            <>
              Nothing open — everything raised against your department has been closed.
              <br />
              <br />
              Anything new will appear here, and anyone in the department can respond to it.
            </>
          ),
        }}
      />
      <PortalSection
        title={labels[1]}
        items={closed}
        empty={{ icon: "📭", text: "Nothing has been closed yet." }}
      />
    </>
  );
}

/* ---------------- "New here?" announcement + walkthrough ---------------- */

const annListeners = new Set<() => void>();
const annKey = (userId: string) => "al_owner_ann_" + (userId || "");

function readAnnDismissed(userId: string): boolean {
  try {
    return !!localStorage.getItem(annKey(userId));
  } catch {
    return false;
  }
}

/** Legacy dismissOwnerAnnounce() — persist + re-render subscribers. */
function dismissOwnerAnnounce(userId: string): void {
  try {
    localStorage.setItem(annKey(userId), "1");
  } catch {
    /* ignore */
  }
  annListeners.forEach((l) => l());
}

function useAnnDismissed(userId: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      annListeners.add(cb);
      return () => annListeners.delete(cb);
    },
    () => readAnnDismissed(userId),
    () => true, // server render: hidden until the client can read localStorage
  );
}

export function OwnerAnnounce({ userId }: { userId: string }) {
  const modal = useModal();
  const dismissed = useAnnDismissed(userId);
  if (dismissed) return null;
  return (
    /* QA-6 — the whole banner used to be a <div onClick>, which was both keyboard-unreachable
       and impossible to wrap in a <button> because it already contains the dismiss control.
       The call to action is its own button instead: no nested interactive elements, and both
       actions are reachable by keyboard. */
    <div className="owner-announce">
      <span className="owner-announce-ico" aria-hidden="true">📌</span>
      <div>
        <b>New here?</b> This list is your whole department&apos;s — anyone in it can answer any
        item. When the work is done, open it and use the <b>Ready for Closure</b> button to send it
        back to Internal Audit.{" "}
        <button
          type="button"
          className="owner-announce-cta"
          onClick={() => modal.open(<OwnerSimulationDialog userId={userId} />)}
        >
          See how it works
        </button>
      </div>
      <button
        className="owner-announce-x"
        type="button"
        onClick={() => dismissOwnerAnnounce(userId)}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

/* ---- first-login walkthrough (modalOwnerSimulation / showSimStep / SIM_STEPS) ---- */

const SIM_STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "1 · An observation is raised",
    body: (
      <>
        When Internal Audit raises an observation against your department, it appears in{" "}
        <b>My Observations</b> — for everyone in the department, not only the person it names.
        Open it to read the finding, the risk and the recommendation.
      </>
    ),
  },
  {
    title: "2 · Anyone in the department can respond",
    body: (
      <>
        Once the remediation work is done, open the observation and click{" "}
        <b>Ready for Closure</b>. You describe exactly what was done — an AI checker makes sure
        it&apos;s concrete — and you can attach evidence. Your name is recorded on the response,
        so the department can share the work without losing track of who did what.
      </>
    ),
  },
  {
    title: "3 · Internal Audit verifies & closes",
    body: (
      <>
        The response goes back to the auditor to verify, then the Head of Audit signs off and
        closes it. The department is notified at each step.
      </>
    ),
  },
];

export function OwnerSimulationDialog({ userId }: { userId: string }) {
  const modal = useModal();
  const [idx, setIdx] = useState(0);
  const s = SIM_STEPS[idx];
  const last = idx >= SIM_STEPS.length - 1;
  return (
    <ModalFrame
      title="How remediation works"
      footer={
        <>
          {idx > 0 ? (
            <button className="btn sec" type="button" onClick={() => setIdx(idx - 1)}>
              Back
            </button>
          ) : (
            <button className="btn sec" type="button" onClick={() => modal.close()}>
              Skip
            </button>
          )}
          <button
            className="btn"
            type="button"
            onClick={() => {
              if (last) {
                dismissOwnerAnnounce(userId);
                modal.close();
              } else {
                setIdx(idx + 1);
              }
            }}
          >
            {last ? "Got it" : "Next →"}
          </button>
        </>
      }
    >
      <div className="onboard-step">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{s.title}</div>
        {s.body}
      </div>
      {idx === 1 ? (
        <div className="myobs-card" style={{ marginTop: 14, cursor: "default" }}>
          <div className="myobs-card-top">
            <span className="pill c-High">High</span>
            <span className="tag">Internal</span>
            <span className="status-pill open">Open</span>
          </div>
          <div className="myobs-card-title">
            Example — Weak segregation of duties in disbursements
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="btn sm" style={{ pointerEvents: "none" }}>✓ Ready for Closure</span>{" "}
            <span className="hint">← the button you&apos;ll press</span>
          </div>
        </div>
      ) : null}
      <div className="onboard-dots" style={{ marginTop: 14 }}>
        {SIM_STEPS.map((_, i) => (
          <span key={i} className={`onboard-dot${i === idx ? " on" : ""}`} />
        ))}
      </div>
    </ModalFrame>
  );
}
