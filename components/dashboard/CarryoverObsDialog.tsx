"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { CritPill, Empty, StatusPill } from "@/components/ui";
import { effectiveClose, fmtDate, daysToClose, type ObsWithContext } from "@/lib/workspace/selectors";
import { hrefForView, isLegacyPath } from "@/lib/routes";

export default function CarryoverObsDialog({
  title,
  subtitle,
  observations,
}: {
  title: string;
  subtitle?: string;
  observations: ObsWithContext[];
}) {
  const modal = useModal();
  const router = useRouter();
  const [filterCrit, setFilterCrit] = useState<string>("All");

  const filtered = filterCrit === "All"
    ? observations
    : observations.filter((o) => o.criticality === filterCrit);

  function handleNavigate(o: ObsWithContext) {
    const href = hrefForView("observation", {
      audit: o._a?.id,
      report: o._r?.id,
      obs: o.id,
    });
    modal.close();
    if (isLegacyPath(href)) {
      window.location.assign(href);
    } else {
      router.push(href);
    }
  }

  return (
    <ModalFrame
      title={title}
      footer={
        <button className="btn sec" type="button" onClick={modal.close}>
          Close
        </button>
      }
    >
      <div style={{ marginBottom: 14 }}>
        <div className="hint" style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
          {subtitle || "All open observations are active carryovers until formally remediated and closed."}
        </div>

        {/* Quick severity filter */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", marginRight: 4 }}>
            Filter:
          </span>
          {["All", "Critical", "High", "Moderate", "Low", "Process Improvement"].map((c) => {
            const count = c === "All" ? observations.length : observations.filter((o) => o.criticality === c).length;
            if (c !== "All" && count === 0) return null;
            const isActive = filterCrit === c;
            return (
              <button
                key={c}
                type="button"
                className={`btn sm ${isActive ? "" : "sec"}`}
                style={{ fontSize: 11, padding: "3px 8px", height: "auto" }}
                onClick={() => setFilterCrit(c)}
              >
                {c} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length ? (
        <div style={{ maxHeight: "60vh", overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
          <table style={{ margin: 0 }}>
            <thead>
              <tr>
                <th scope="col" style={{ width: 110 }}>Ref</th>
                <th scope="col" style={{ width: 90 }}>Criticality</th>
                <th scope="col">Observation Title</th>
                <th scope="col">Action Owner</th>
                <th scope="col" style={{ width: 110 }}>Target Close</th>
                <th scope="col" style={{ width: 95 }}>Status</th>
                <th scope="col" style={{ textAlign: "right", width: 70 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const ec = effectiveClose(o, o._r);
                const d = daysToClose(o, o._r);
                return (
                  <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => handleNavigate(o)}>
                    <td>
                      <span className="tag" style={{ fontWeight: 600 }}>
                        {o.ref || `OBS-${o.id.slice(-4)}`}
                      </span>
                    </td>
                    <td>
                      <CritPill crit={o.criticality} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--ink)", lineHeight: 1.3 }}>
                        {o.title}
                      </div>
                      <div className="hint" style={{ fontSize: 11, marginTop: 2 }}>
                        {o._a?.name}
                      </div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {o.owner || "Unassigned"}
                    </td>
                    <td>
                      {ec ? (
                        <div style={{ fontSize: 11 }}>
                          <div>{fmtDate(ec)}</div>
                          {d != null && (
                            <span
                              style={{
                                display: "inline-block",
                                marginTop: 2,
                                fontSize: 10,
                                fontWeight: 700,
                                color: d < 0 ? "#b00020" : d <= 14 ? "#e8590c" : "#2e7d32",
                              }}
                            >
                              {d < 0 ? `${-d}d overdue` : `${d}d left`}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                    <td>
                      <StatusPill status={o.status} />
                    </td>
                    <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn sec sm"
                        type="button"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={() => handleNavigate(o)}
                        title="Open observation details"
                      >
                        Open →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No observations match this filter.</Empty>
      )}
    </ModalFrame>
  );
}
