"use client";

// Action-owner dashboard — React port of viewOwnerDashboard().

import { useRouter } from "next/navigation";
import { useUser } from "@/components/chrome/UserContext";
import { CritPill, Empty, Kpi, StatusPill } from "@/components/ui";
import { hrefForView } from "@/lib/routes";
import {
  allObs,
  daysBetween,
  daysToClose,
  effectiveClose,
  extList,
  extOverdue,
  fmtDate,
  hx2rgba,
  isOverdueObs,
  looseDate,
  obsIsApproved,
  today0,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import type { ExtFinding } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const EXT_SEV_HEX: Record<string, string> = { High: "#b00020", Medium: "#c9a300", Low: "#2e7d32" };

function extDueSoon(f: ExtFinding): boolean {
  if (f.status === "Closed") return false;
  const d = looseDate(f.targetDate);
  if (!d) return false;
  const days = daysBetween(today0(), d);
  return days >= 0 && days <= 14;
}

type AttentionItem = { kind: "Internal" | "External"; o: ObsWithContext | ExtFinding };

export default function OwnerDashboard() {
  const { db } = useWorkspace();
  const user = useUser();
  const router = useRouter();

  const intMine = allObs(db).filter(
    (o) =>
      ((o.ownerUserId && o.ownerUserId === user.id) ||
        (o.secondaryOwnerUserId && o.secondaryOwnerUserId === user.id)) &&
      obsIsApproved(o),
  );
  const extMine = extList(db).filter(
    (f) =>
      (f.ownerUserId && f.ownerUserId === user.id) ||
      (f.secondaryOwnerUserId && f.secondaryOwnerUserId === user.id),
  );
  const intOpen = intMine.filter((o) => o.status !== "Closed");
  const extOpen = extMine.filter((f) => f.status !== "Closed");
  const intOverdue = intOpen.filter((o) => isOverdueObs(o, o._r));
  const extOverdueL = extOpen.filter(extOverdue);
  const intSoon = intOpen.filter((o) => {
    const d = daysToClose(o, o._r);
    return d != null && d >= 0 && d <= 14;
  });
  const extSoon = extOpen.filter(extDueSoon);

  const totalMine = intMine.length + extMine.length;
  const totalOpen = intOpen.length + extOpen.length;
  const totalOverdue = intOverdue.length + extOverdueL.length;
  const totalClosed = totalMine - totalOpen;

  const attention: AttentionItem[] = [
    ...intOverdue.map((o) => ({ kind: "Internal" as const, o })),
    ...intSoon.filter((o) => !intOverdue.includes(o)).map((o) => ({ kind: "Internal" as const, o })),
    ...extOverdueL.map((o) => ({ kind: "External" as const, o })),
    ...extSoon.filter((o) => !extOverdueL.includes(o)).map((o) => ({ kind: "External" as const, o })),
  ];

  function openItem(x: AttentionItem) {
    const href =
      x.kind === "External"
        ? hrefForView("extfinding", { ext: (x.o as ExtFinding).id })
        : hrefForView("observation", {
            audit: (x.o as ObsWithContext)._a.id,
            report: (x.o as ObsWithContext)._r.id,
            obs: x.o.id,
          });
    if (href.startsWith("/legacy")) window.location.assign(href);
    else router.push(href);
  }

  return (
    <>
      <div className="dash-welcome anim-fade-in">
        <div className="dash-welcome-text">
          <h1>Welcome, {(user.name || "there").split(/\s+/)[0]}</h1>
          <p className="dash-welcome-role">{user.department || "Action Owner"}</p>
        </div>
        <div className="spacer" />
        <a className="btn" href={hrefForView("myobs")}>
          My observations →
        </a>
      </div>
      <div className="dash-kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <Kpi tone="accent" label="Assigned to me" value={totalMine} sub="internal + external" />
        <Kpi tone="warn" label="Open" value={totalOpen} sub="awaiting your action" />
        <Kpi tone="warn" label="Overdue" value={totalOverdue} sub="past expected close" />
        <Kpi tone="good" label="Closed" value={totalClosed} sub="resolved" icon="check" />
      </div>

      <div className="card">
        <div className="seclabel">Needs your attention</div>
        {!attention.length ? (
          <Empty big={totalMine > 0 ? "✅" : "📭"}>
            {totalMine > 0 ? (
              "Nothing overdue or due within 2 weeks — you're on track."
            ) : (
              <>
                Nothing has been assigned to you yet.
                <br />
                <br />
                Observations and external findings appear here once Internal Audit assigns them to
                your department.
              </>
            )}
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Priority</th>
                <th>Item</th>
                <th>Source / Audit</th>
                <th>Expected close</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {attention.map((x) => {
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
                      <b>{o.title}</b>
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
