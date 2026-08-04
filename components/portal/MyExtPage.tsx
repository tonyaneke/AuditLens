"use client";

// Action-Owner portal — External Observations. React port of viewMyExt() in audit-bot.js.
// Carries the same status filter as MyObsPage; an owner's external register is one list for the
// same reason and splits into the same buckets (see ownerStatusOf).

import { useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { Empty } from "@/components/ui";
import { OWNER_STATUSES, myExtList, ownerStatusOf } from "@/lib/workspace/portal";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { MyObsSections, PortalSection, type PortalItem } from "./cards";

export default function MyExtPage() {
  usePageChrome({ title: "External Observations" });
  const { db } = useWorkspace();
  const user = useUser();
  const [sev, setSev] = useState("All");
  const [status, setStatus] = useState("All");

  const items0: PortalItem[] = myExtList(db, user.id).map((o) => ({ o, type: "External" }));

  if (!items0.length) {
    return (
      <div className="card">
        <Empty big="❖">
          No external findings assigned to you yet.
          <br />
          <br />
          When an external / regulatory finding is assigned to your department, it appears here for
          you to respond, add updates and evidence.
        </Empty>
      </div>
    );
  }

  const items = items0
    .filter((x) => sev === "All" || x.o.severity === sev)
    .filter((x) => status === "All" || ownerStatusOf(x.o) === status);
  const filtersActive = sev !== "All" || status !== "All";

  return (
    <>
      <div className="card" style={{ padding: "12px 16px", marginBottom: 4 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="filter-group">
            <span className="filter-label" id="me-status">Status</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="me-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {["All", ...OWNER_STATUSES].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-label" id="me-sev">Severity</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="me-sev"
              value={sev}
              onChange={(e) => setSev(e.target.value)}
            >
              {["All", "High", "Medium", "Low"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {filtersActive ? (
            <button
              className="btn ghost sm"
              type="button"
              onClick={() => {
                setSev("All");
                setStatus("All");
              }}
            >
              Clear
            </button>
          ) : null}
          <div className="spacer" style={{ flex: 1 }} />
          <span className="hint">
            {filtersActive ? `Showing ${items.length} of ${items0.length}` : `${items0.length} total`}
          </span>
        </div>
      </div>

      {status === "All" ? (
        <MyObsSections
          items={items}
          labels={["Open external findings", "Closed external findings"]}
        />
      ) : (
        <PortalSection title={status} items={items} />
      )}
    </>
  );
}
