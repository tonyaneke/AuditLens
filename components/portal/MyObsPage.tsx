"use client";

// Action-Owner portal — Internal Observations. React port of viewMyObs() in audit-bot.js.
//
// DEPARTS FROM LEGACY twice.
//  1. Legacy filtered on criticality only, so a head of department with a large register got one
//     long list and had to read every card to find the ones still on their plate. The status
//     filter adds the buckets they actually work in — including "Ready for Closure", which is
//     derived rather than stored (see ownerStatusOf) and is the line between "mine" and "with
//     Internal Audit" — plus withdrawn, which is its own list entirely.
//  2. The list is the DEPARTMENT's, not one person's (2026-08-05). Anyone in the department can
//     answer any of them, so the "Assigned to you" filter is what narrows it back down to the
//     items with your own name on them.

import { useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { Empty } from "@/components/ui";
import {
  OWNER_STATUSES,
  isAssignedTo,
  ownerStatusOf,
  portalObsList,
  portalWithdrawnObs,
} from "@/lib/workspace/portal";
import { CRITS } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { MyObsCard, MyObsSections, OwnerAnnounce, PortalSection, type PortalItem } from "./cards";

const WITHDRAWN = "Withdrawn";

/* The department/mine switch. Default is the whole department — that is the point of the change,
   and someone who only wants their own name flips it, rather than the other way round. */
const SCOPE_ALL = "My department";
const SCOPE_MINE = "Assigned to me";

export default function MyObsPage() {
  usePageChrome({ title: "Internal Observations" });
  const { db } = useWorkspace();
  const user = useUser();
  const [crit, setCrit] = useState("All");
  const [status, setStatus] = useState("All");
  const [scope, setScope] = useState(SCOPE_ALL);

  const items0: PortalItem[] = portalObsList(db, user).map((o) => ({ o, type: "Internal" }));
  const withdrawn0: PortalItem[] = portalWithdrawnObs(db, user).map((o) => ({
    o,
    type: "Internal",
  }));

  if (!items0.length && !withdrawn0.length) {
    return (
      <>
        <OwnerAnnounce userId={user.id} />
        <div className="card">
          <Empty big="✦">
            No internal observations for your department yet.
            <br />
            <br />
            When Internal Audit raises an observation against your department, it appears here for
            anyone in the department to respond, add updates and evidence.
          </Empty>
        </div>
      </>
    );
  }

  const byCrit = (x: PortalItem) => crit === "All" || x.o.criticality === crit;
  const byScope = (x: PortalItem) => scope === SCOPE_ALL || isAssignedTo(x.o, user.id);
  // Withdrawn observations are not in `items0` at all, so they are filtered on their own — and
  // they carry no live status, which is why "Withdrawn" is a bucket rather than a status value.
  const items = items0
    .filter(byCrit)
    .filter(byScope)
    .filter((x) => status === "All" || ownerStatusOf(x.o) === status);
  const withdrawn = withdrawn0.filter(byCrit).filter(byScope);
  const showWithdrawn = status === "All" || status === WITHDRAWN;
  const shown = (status === WITHDRAWN ? 0 : items.length) + (showWithdrawn ? withdrawn.length : 0);
  const total = items0.length + withdrawn0.length;
  const filtersActive = crit !== "All" || status !== "All" || scope !== SCOPE_ALL;

  return (
    <>
      <OwnerAnnounce userId={user.id} />
      <div className="card" style={{ padding: "12px 16px", marginBottom: 4 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="filter-group">
            <span className="filter-label" id="mo-scope">Show</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="mo-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              {[SCOPE_ALL, SCOPE_MINE].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-label" id="mo-status">Status</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="mo-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {["All", ...OWNER_STATUSES, WITHDRAWN].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-label" id="mo-crit">Criticality</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="mo-crit"
              value={crit}
              onChange={(e) => setCrit(e.target.value)}
            >
              {["All", ...CRITS].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {filtersActive ? (
            <button
              className="btn ghost sm"
              type="button"
              onClick={() => {
                setCrit("All");
                setStatus("All");
                setScope(SCOPE_ALL);
              }}
            >
              Clear
            </button>
          ) : null}
          <div className="spacer" style={{ flex: 1 }} />
          <span className="hint">
            {filtersActive ? `Showing ${shown} of ${total}` : `${total} total`}
          </span>
        </div>
      </div>

      {status === "All" ? (
        <MyObsSections items={items} labels={["Open observations", "Closed observations"]} />
      ) : status === WITHDRAWN ? null : (
        <PortalSection title={status} items={items} />
      )}

      {/* The withdrawn list stays out of the Open/Closed split — a withdrawn observation is
          neither, and pulling it into either one would overstate what the department still owes.
          It is shown unfiltered by status only when nothing narrower was asked for. */}
      {showWithdrawn && (withdrawn.length || status === WITHDRAWN) ? (
        <>
          <div className="seclabel" style={{ margin: "20px 0 12px" }}>
            Withdrawn observations{" "}
            <span className="hint" style={{ fontWeight: 400 }}>({withdrawn.length})</span>
          </div>
          {withdrawn.length ? (
            <>
              <p className="hint" style={{ margin: "-6px 0 10px" }}>
                These were reviewed and withdrawn — no further action is needed.
              </p>
              <div className="myobs-grid">
                {withdrawn.map((x) => (
                  <MyObsCard key={x.o.id} item={x} />
                ))}
              </div>
            </>
          ) : (
            <div className="hint" style={{ marginBottom: 8 }}>Nothing here.</div>
          )}
        </>
      ) : null}
    </>
  );
}
