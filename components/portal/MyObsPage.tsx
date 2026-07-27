"use client";

// Action-Owner portal — Internal Observations. React port of viewMyObs() in audit-bot.js.

import { useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { Empty } from "@/components/ui";
import { myObsList, myWithdrawnObs } from "@/lib/workspace/portal";
import { CRITS } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { MyObsCard, MyObsSections, OwnerAnnounce, type PortalItem } from "./cards";

export default function MyObsPage() {
  usePageChrome({ title: "Internal Observations" });
  const { db } = useWorkspace();
  const user = useUser();
  const [crit, setCrit] = useState("All");

  const items0: PortalItem[] = myObsList(db, user.id).map((o) => ({ o, type: "Internal" }));
  const withdrawn: PortalItem[] = myWithdrawnObs(db, user.id).map((o) => ({
    o,
    type: "Internal",
  }));

  if (!items0.length && !withdrawn.length) {
    return (
      <>
        <OwnerAnnounce userId={user.id} />
        <div className="card">
          <Empty big="✦">
            No internal observations assigned to you yet.
            <br />
            <br />
            When Internal Audit raises an observation against your department, it appears here for
            you to respond, add updates and evidence.
          </Empty>
        </div>
      </>
    );
  }

  const items = crit !== "All" ? items0.filter((x) => x.o.criticality === crit) : items0;

  return (
    <>
      <OwnerAnnounce userId={user.id} />
      <div className="card" style={{ padding: "12px 16px", marginBottom: 4 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="filter-group">
            <span className="filter-label">Criticality</span>
            <select
              className="field-select field-select-sm"
              value={crit}
              onChange={(e) => setCrit(e.target.value)}
            >
              {["All", ...CRITS].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {crit !== "All" ? (
            <button className="btn ghost sm" type="button" onClick={() => setCrit("All")}>
              Clear
            </button>
          ) : null}
          <div className="spacer" style={{ flex: 1 }} />
          <span className="hint">{items0.length} total</span>
        </div>
      </div>
      <MyObsSections items={items} labels={["Open observations", "Closed observations"]} />
      {withdrawn.length ? (
        <>
          <div className="seclabel" style={{ margin: "20px 0 12px" }}>
            Withdrawn observations{" "}
            <span className="hint" style={{ fontWeight: 400 }}>({withdrawn.length})</span>
          </div>
          <p className="hint" style={{ margin: "-6px 0 10px" }}>
            These were reviewed and withdrawn — no further action is needed.
          </p>
          <div className="myobs-grid">
            {withdrawn.map((x) => (
              <MyObsCard key={x.o.id} item={x} />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
