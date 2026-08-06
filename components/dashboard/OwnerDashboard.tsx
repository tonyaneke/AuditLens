"use client";

// Action-owner dashboard — React port of viewOwnerDashboard().

import { useRouter } from "next/navigation";
import { useUser } from "@/components/chrome/UserContext";
import { CritPill, Empty, Kpi, RowOpen, StatusPill } from "@/components/ui";
import { displayRoleLabel } from "@/lib/permissions";
import { hrefForView, isLegacyPath } from "@/lib/routes";
import {
  daysBetween,
  daysToClose,
  effectiveClose,
  extList,
  extOverdue,
  fmtDate,
  hx2rgba,
  isOverdueObs,
  looseDate,
  today0,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import {
  myFraudActionsFor,
  myFraudRisks,
  portalExtList,
  portalObsList,
} from "@/lib/workspace/portal";
import type { ExtFinding, FraudAction, FraudRisk } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const EXT_SEV_HEX: Record<string, string> = { High: "#b00020", Medium: "#c9a300", Low: "#2e7d32" };

function extDueSoon(f: ExtFinding): boolean {
  if (f.status === "Closed") return false;
  const d = looseDate(f.targetDate);
  if (!d) return false;
  const days = daysBetween(today0(), d);
  return days >= 0 && days <= 14;
}

type AttentionItem =
  | { kind: "Internal" | "External"; o: ObsWithContext | ExtFinding }
  | { kind: "Fraud"; f: FraudRisk; a: FraudAction };

export default function OwnerDashboard() {
  const { db } = useWorkspace();
  const user = useUser();
  const router = useRouter();

  /* Both registers are the DEPARTMENT's (observations 2026-08-05, external findings 2026-08-06) —
     anyone in it can answer any of them, so a dashboard counting only the ones bearing this
     person's name understated what the department owed. Fraud actions are unchanged: those are
     still assigned to an individual. */
  const intMine = portalObsList(db, user);
  const extMine = portalExtList(db, user);
  const intOpen = intMine.filter((o) => o.status !== "Closed");
  const extOpen = extMine.filter((f) => f.status !== "Closed");
  const intOverdue = intOpen.filter((o) => isOverdueObs(o, o._r));
  const extOverdueL = extOpen.filter(extOverdue);
  const intSoon = intOpen.filter((o) => {
    const d = daysToClose(o, o._r);
    return d != null && d >= 0 && d <= 14;
  });
  const extSoon = extOpen.filter(extDueSoon);

  // Fraud prevention actions assigned to me (risk-level or per-action assignment).
  const fraudMine = myFraudRisks(db, user.id).flatMap((f) =>
    myFraudActionsFor(f, user.id).map((a) => ({ f, a })),
  );
  const fraudOpen = fraudMine.filter((x) => x.a.status !== "Implemented");

  const totalMine = intMine.length + extMine.length;
  const totalOpen = intOpen.length + extOpen.length;
  const totalOverdue = intOverdue.length + extOverdueL.length;
  const totalClosed = totalMine - totalOpen;

  const attention: AttentionItem[] = [
    ...intOverdue.map((o) => ({ kind: "Internal" as const, o })),
    ...intSoon.filter((o) => !intOverdue.includes(o)).map((o) => ({ kind: "Internal" as const, o })),
    ...extOverdueL.map((o) => ({ kind: "External" as const, o })),
    ...extSoon.filter((o) => !extOverdueL.includes(o)).map((o) => ({ kind: "External" as const, o })),
    // Open fraud prevention actions always need attention — their targets are free-text
    // ("Q3 2026"), so there is no computable due date to filter on.
    ...fraudOpen.map(({ f, a }) => ({ kind: "Fraud" as const, f, a })),
  ];

  function openItem(x: AttentionItem) {
    const href =
      x.kind === "Fraud"
        ? hrefForView("myfraud")
        : x.kind === "External"
          ? hrefForView("extfinding", { ext: (x.o as ExtFinding).id })
          : hrefForView("observation", {
              audit: (x.o as ObsWithContext)._a.id,
              report: (x.o as ObsWithContext)._r.id,
              obs: x.o.id,
            });
    if (isLegacyPath(href)) window.location.assign(href);
    else router.push(href);
  }

  return (
    <>
      <div className="dash-welcome anim-fade-in">
        <div className="dash-welcome-text">
          <h1>Welcome, {(user.name || "there").split(/\s+/)[0]}</h1>
          {/* QA-14 — the role, then the department as context. Previously the department
              replaced the role entirely, so this screen never agreed with the sidebar. */}
          <p className="dash-welcome-role">
            {displayRoleLabel(user)}
            {user.department ? ` · ${user.department}` : ""}
          </p>
        </div>
        <div className="spacer" />
      </div>
      <div className="dash-kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <Kpi
          tone="accent"
          label="My department"
          value={totalMine}
          sub={`${intMine.length} Internal · ${extMine.length} External`}
        />
        <Kpi tone="warn" label="Open" value={totalOpen} sub="awaiting a response" />
        <Kpi tone="warn" label="Overdue" value={totalOverdue} sub="past expected close" />
        <Kpi tone="good" label="Closed" value={totalClosed} sub="resolved" icon="check" />
      </div>

      <div className="card">
        <div className="seclabel">Needs attention</div>
        {!attention.length ? (
          <Empty big={totalMine + fraudMine.length > 0 ? "✅" : "📭"}>
            {totalMine + fraudMine.length > 0 ? (
              "Nothing overdue or due within 2 weeks — your department is on track."
            ) : (
              <>
                Nothing is outstanding for your department yet.
                <br />
                <br />
                Observations and external findings appear here once Internal Audit raises them
                against your department.
              </>
            )}
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Priority</th>
                <th scope="col">Item</th>
                <th scope="col">Source / Audit</th>
                <th scope="col">Expected close</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {attention.map((x) => {
                if (x.kind === "Fraud") {
                  return (
                    <tr
                      className="tracker-row"
                      key={`Fraud-${x.f.id}-${x.a.id}`}
                      onClick={() => openItem(x)}
                      title="Open Fraud Risk Control Tracker"
                    >
                      <td>
                        <span className="tag">Fraud action</span>
                      </td>
                      <td>
                        <span className="tag">{x.a.type || "Preventive"}</span>
                      </td>
                      <td>
                        <RowOpen onOpen={() => openItem(x)} label={`Open fraud action: ${x.a.text}`}>
                          <b>{x.a.text}</b>
                        </RowOpen>
                      </td>
                      <td>
                        {x.f.scheme}
                        <div className="hint">{x.f.category || ""}</div>
                      </td>
                      <td>{x.a.targetDate || "—"}</td>
                      <td>
                        <StatusPill status={x.a.status || "Planned"} />
                      </td>
                    </tr>
                  );
                }
                const ext = x.kind === "External";
                const o = x.o as ObsWithContext & ExtFinding;
                const sv = EXT_SEV_HEX[String(o.severity || "")] || "#64748b";
                const ec = ext ? looseDate(o.targetDate) : effectiveClose(o, o._r);
                const od = ext ? extOverdue(o) : isOverdueObs(o, o._r);
                const ecStr = ext ? o.targetDate || "—" : ec ? fmtDate(ec) : "—";
                return (
                  <tr className="tracker-row" key={`${x.kind}-${o.id}`} onClick={() => openItem(x)} title="Open">
                    <td>
                      <span className="tag">{x.kind}</span>
                    </td>
                    <td>
                      {ext ? (
                        <span className="pill" style={{ background: hx2rgba(sv, 0.16), color: sv }}>
                          {o.severity || "—"}
                        </span>
                      ) : (
                        <CritPill crit={o.criticality} />
                      )}
                    </td>
                    <td>
                      <RowOpen onOpen={() => openItem(x)} label={`Open ${x.kind.toLowerCase()}: ${o.title}`}>
                        <b>{o.title}</b>
                      </RowOpen>
                    </td>
                    <td>
                      {ext ? (
                        <>
                          {o.source || "—"}
                          {o.year ? " · " + o.year : ""}
                        </>
                      ) : (
                        <>
                          {o._a.name}
                          <div className="hint">{(o._a.area as string) || ""}</div>
                        </>
                      )}
                    </td>
                    <td>
                      {ecStr}
                      {od ? (
                        <>
                          {" "}
                          <span className="pill c-Critical">overdue</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <StatusPill status={o.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
