"use client";

// Action-Owner portal — External Observations. React port of viewMyExt() in audit-bot.js.

import { useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { Empty } from "@/components/ui";
import { myExtList } from "@/lib/workspace/portal";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { MyObsSections, type PortalItem } from "./cards";

export default function MyExtPage() {
  usePageChrome({ title: "External Observations" });
  const { db } = useWorkspace();
  const user = useUser();
  const [sev, setSev] = useState("All");

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

  const items = sev !== "All" ? items0.filter((x) => x.o.severity === sev) : items0;

  return (
    <>
      <div className="card" style={{ padding: "12px 16px", marginBottom: 4 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="filter-group">
            <span className="filter-label">Severity</span>
            <select
              className="field-select field-select-sm"
              value={sev}
              onChange={(e) => setSev(e.target.value)}
            >
              {["All", "High", "Medium", "Low"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {sev !== "All" ? (
            <button className="btn ghost sm" type="button" onClick={() => setSev("All")}>
              Clear
            </button>
          ) : null}
          <div className="spacer" style={{ flex: 1 }} />
          <span className="hint">{items0.length} total</span>
        </div>
      </div>
      <MyObsSections
        items={items}
        labels={["Open external findings", "Closed external findings"]}
      />
    </>
  );
}
