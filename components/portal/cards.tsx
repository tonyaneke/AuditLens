"use client";

// Shared building blocks for the Action-Owner portal list pages — ports of myObsCard(),
// myObsSectionsHTML(), ownerAnnounceHTML()/dismissOwnerAnnounce() and the first-login
// walkthrough (modalOwnerSimulation/showSimStep) from audit-bot.js.

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useUser } from "@/components/chrome/UserContext";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { CritPill, Empty, RowOpen, StatusPill, TintPill } from "@/components/ui";
import { deptLabel, deptNameOf } from "@/lib/dept-scope";
import { hrefForView, isLegacyPath } from "@/lib/routes";
import { EXT_SEV_HEX, isAssignedTo } from "@/lib/workspace/portal";
import {
  effectiveClose,
  extOverdue,
  fmtDate,
  isOverdueObs,
  looseDate,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import type { ExtFinding } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

/* ---------------- card list item ---------------- */

export type PortalItem =
  | { o: ObsWithContext; type: "Internal" }
  | { o: ExtFinding; type: "External" };

/* One item's worth of derived facts, read by BOTH the grid card and the list row.
   The two views show the same register through different lenses, so anything either of them
   computes about an item has to be computed once — a card and a row disagreeing about the same
   observation's expected close is the kind of thing an action owner reports as a data bug. */
function usePortalFacts(item: PortalItem) {
  const user = useUser();
  const { db } = useWorkspace();
  const ext = item.type === "External";
  const o = item.o;
  const obs = o as ObsWithContext;
  const fin = o as ExtFinding;

  /* External findings carry the closure date twice: the register dialog writes targetDate, while
     the raise/assign flows write dueDate and mirror it onto targetDate. Reading targetDate first
     and falling back covers both — the card used to read dueDate alone, so anything entered
     straight into the register showed no expected close at all. */
  const close = ext ? looseDate(fin.targetDate || fin.dueDate) : effectiveClose(obs, obs._r);

  return {
    ext,
    /* Whose item this is. The portal lists the whole department's, so every card and row has to
       say whether this one is yours to answer or a colleague's — without it the list reads as
       "all of this is on me". */
    mine: isAssignedTo(o, user.id),
    /* And which department it belongs to, which matters most to the people who cover two: the
       Chief of Staff's list mixes the MD's office with Corporate Communications, and without the
       tag there is nothing to tell them apart. */
    dept: deptLabel(deptNameOf(db, o)),
    // Source · year for a regulator's finding; audit · area for an internal one.
    ctxMain: ext ? fin.source || "—" : obs._a.name,
    ctxSub: ext ? String(fin.year || "") : String(obs._a.area || ""),
    close: close ? fmtDate(close) : "",
    /* Overdue comes from the shared selectors and nowhere else, so the portal cannot drift from
       the dashboard KPI or the EXCO brief the way the Tracker once did (QA-11). */
    overdue: ext ? extOverdue(fin) : isOverdueObs(obs, obs._r),
    rfc: !!o.ownerRectifiedAt && (o.status || "Open") !== "Closed",
    sev: EXT_SEV_HEX[String(fin.severity || "")] || "#64748b",
    href: ext
      ? hrefForView("extfinding", { ext: o.id })
      : hrefForView("observation", { audit: obs._a.id, report: obs._r.id, obs: o.id }),
  };
}

function useOpenItem(href: string) {
  const router = useRouter();
  return function open() {
    // Cross-shell navigation must be a full page load (legacy script boots on a fresh document).
    if (isLegacyPath(href)) window.location.assign(href);
    else router.push(href);
  };
}

/** What a row/card is called in an accessible name — "observation" reads wrong for a regulator's
 *  finding, and these names are all a screen-reader user has to tell one row from the next. */
function itemNoun(item: PortalItem): string {
  return item.type === "External" ? "external finding" : "observation";
}

export function MyObsCard({ item }: { item: PortalItem }) {
  const f = usePortalFacts(item);
  const open = useOpenItem(f.href);
  const o = item.o;
  const ctx = f.ctxMain + (f.ctxSub ? " · " + f.ctxSub : "");

  return (
    /* QA-6 — was a <div onClick>. This is an action owner's primary route into their own
       observations, so it being keyboard-unreachable locked them out of the portal entirely. */
    <button type="button" className="myobs-card" onClick={open} title="Open">
      <div className="myobs-card-top">
        {f.ext ? (
          <TintPill hex={f.sev}>{(o as ExtFinding).severity || "—"}</TintPill>
        ) : (
          <CritPill crit={(o as ObsWithContext).criticality} />
        )}
        <span className="tag">{item.type}</span>
        {f.dept ? <span className="tag">{f.dept}</span> : null}
        <StatusPill status={o.status} />
        {f.rfc ? <span className="pill pill-rfc">Ready for closure</span> : null}
      </div>
      <div className="myobs-card-title">{o.title}</div>
      <div className="myobs-card-meta">
        {ctx}
        {" · "}
        {f.mine ? "Assigned to you" : `Owner: ${o.owner || "unassigned"}`}
      </div>
      {f.close ? (
        <div className="myobs-card-foot">
          <span className="hint">Expected close</span>
          <span>
            {f.close}
            {f.overdue ? <span className="pill c-Critical portal-overdue">overdue</span> : null}
          </span>
        </div>
      ) : null}
    </button>
  );
}

/* ---------------- list view ----------------
   The same items as the grid, laid out like the dashboard's "Needs attention" table. Cards are
   the prettier object but a poor register: an owner scanning two dozen observations for how many
   are overdue, whose they are and what is still open reads a column far faster than they read a
   wall of tiles, and the columns line the answers up for counting. */

function PortalRow({ item }: { item: PortalItem }) {
  const f = usePortalFacts(item);
  const open = useOpenItem(f.href);
  const o = item.o;

  return (
    <tr className="tracker-row" onClick={open} title="Open">
      <td>
        {f.ext ? (
          <TintPill hex={f.sev}>{(o as ExtFinding).severity || "—"}</TintPill>
        ) : (
          <CritPill crit={(o as ObsWithContext).criticality} />
        )}
      </td>
      <td>
        {/* The row's onClick is pointer-only; RowOpen is the keyboard entry point (see ui/index). */}
        <RowOpen onOpen={open} label={`Open ${itemNoun(item)}: ${o.title}`}>
          <b>{o.title}</b>
        </RowOpen>
      </td>
      <td>
        {f.ctxMain}
        {f.ctxSub ? <div className="hint">{f.ctxSub}</div> : null}
      </td>
      <td>{f.dept || <span className="hint">—</span>}</td>
      <td>
        {o.owner || <span className="hint">Unassigned</span>}
        {f.mine ? <div className="portal-you">Assigned to you</div> : null}
      </td>
      <td>
        {f.close || <span className="hint">—</span>}
        {f.overdue ? <span className="pill c-Critical portal-overdue">overdue</span> : null}
      </td>
      <td>
        <StatusPill status={o.status} />
        {f.rfc ? (
          <div className="portal-status-extra">
            <span className="pill pill-rfc">Ready for closure</span>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function PortalTable({ items }: { items: PortalItem[] }) {
  return (
    <div className="portal-list-wrap">
      <table className="portal-list">
        <thead>
          <tr>
            <th scope="col">Priority</th>
            <th scope="col">Item</th>
            <th scope="col">Source / Audit</th>
            <th scope="col">Department</th>
            <th scope="col">Owner</th>
            <th scope="col">Expected close</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <PortalRow key={x.o.id} item={x} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- list / grid preference ----------------
   Persisted, and shared by both portal registers: someone who switches to the list on Internal
   Observations is telling us how they read a register, not how they read one page, and finding
   External still in cards would just be a second switch to flip. Same localStorage +
   useSyncExternalStore shape as the announcement below — no hydration mismatch, and every mounted
   toggle/section re-renders together.

   The grid stays the default, so nothing changes for an owner who never touches the switch; the
   list is there for the ones scanning a register rather than reading one item. */

export type PortalView = "list" | "grid";

const VIEW_KEY = "al_portal_view";
const viewListeners = new Set<() => void>();

function readPortalView(): PortalView {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function setPortalView(v: PortalView): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* ignore */
  }
  viewListeners.forEach((l) => l());
}

export function usePortalView(): PortalView {
  return useSyncExternalStore(
    (cb) => {
      viewListeners.add(cb);
      return () => viewListeners.delete(cb);
    },
    readPortalView,
    () => "grid", // server render: the default, until the client can read localStorage
  );
}

const VIEW_ICONS: Record<PortalView, ReactNode> = {
  list: (
    <svg className="view-toggle-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  ),
  grid: (
    <svg className="view-toggle-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  ),
};

/** The list/grid switch. Two toggle buttons rather than a <select>: it is a two-state preference
 *  whose current value should be visible without opening anything. */
export function PortalViewToggle() {
  const view = usePortalView();
  return (
    <div className="view-toggle" role="group" aria-label="View">
      {(["list", "grid"] as const).map((v) => (
        <button
          key={v}
          type="button"
          className="view-toggle-btn"
          aria-pressed={view === v}
          title={v === "list" ? "List view" : "Grid view"}
          onClick={() => setPortalView(v)}
        >
          {VIEW_ICONS[v]}
          {v === "list" ? "List" : "Grid"}
        </button>
      ))}
    </div>
  );
}

/* ---------------- open / closed sections (myObsSectionsHTML) ---------------- */

/** One titled, counted bucket of portal items, rendered in whichever view is selected. Split out
 *  of MyObsSections so a status-filtered portal can render a single bucket instead of an
 *  Open/Closed pair where one side is always empty ("Open observations (0)" above the closed ones
 *  reads like a bug). */
export function PortalSection({
  title,
  items,
  empty,
  note,
}: {
  title: string;
  items: PortalItem[];
  /** What this particular bucket being empty means. Defaults to the neutral wording. */
  empty?: { icon: string; text: ReactNode };
  /** Optional line under the heading explaining what is in the bucket. */
  note?: ReactNode;
}) {
  const view = usePortalView();
  const heading = (
    <>
      {title} <span className="hint" style={{ fontWeight: 400 }}>({items.length})</span>
    </>
  );
  /* Was a bare line of grey text, which read as the page having failed to load rather than as a
     section with nothing in it — and an empty "Open observations" is usually good news, so it
     should look deliberate. Same .empty card every other empty list on the site uses. */
  const nothing = <Empty big={empty?.icon || "—"}>{empty?.text || "Nothing here."}</Empty>;

  /* List view is the dashboard's "Needs attention" panel: heading, count and table in one card.
     Same shape deliberately — it is the layout this was asked to feel like. */
  if (view === "list") {
    return (
      <div className="card portal-list-card">
        <div className="seclabel">{heading}</div>
        {items.length ? (
          <>
            {note}
            <PortalTable items={items} />
          </>
        ) : (
          nothing
        )}
      </div>
    );
  }

  return (
    <>
      <div className="seclabel" style={{ margin: "20px 0 12px" }}>
        {heading}
      </div>
      {items.length ? (
        <>
          {note}
          <div className="myobs-grid">
            {items.map((x) => (
              <MyObsCard key={x.o.id} item={x} />
            ))}
          </div>
        </>
      ) : (
        <div className="card">{nothing}</div>
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
