"use client";

// Process & Control Effectiveness Review — React port of viewProcess() (list mode) and its
// "+ New review" topbar action. Clicking a card deep-links to /process/{id} (the legacy shell
// set curProc and re-rendered instead).

import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useModal } from "@/components/modals/ModalProvider";
import { Empty } from "@/components/ui";
import { urlForView } from "@/lib/routes";
import {
  PROC_CATS,
  PROC_RATING_HEX,
  procCatCounts,
  procList,
} from "@/lib/workspace/process";
import { hx2rgba } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { ProcNewDialog } from "./dialogs";

export default function ProcessListPage() {
  const { db } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const P = procList(db);

  usePageChrome(
    {
      title: "Process Review",
      actions: (
        <button className="btn sm" type="button" onClick={() => modal.open(<ProcNewDialog />)}>
          + New review
        </button>
      ),
    },
    [],
  );

  if (!P.length) {
    return (
      <div className="card">
        <Empty big="◫">
          No process reviews yet.
          <br />
          <br />
          <button className="btn dark" type="button" onClick={() => modal.open(<ProcNewDialog />)}>
            + New process review
          </button>
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{P.length} process review(s)</div>
      </div>
      {P.slice()
        .reverse()
        .map((p) => {
          const counts = procCatCounts(p.findings || []);
          const rh = PROC_RATING_HEX[p.overallRating || ""] || "#64748b";
          const tiles = PROC_CATS.filter(([c]) => counts[c]);
          return (
            <div
              className="listcard"
              key={p.id}
              onClick={() => router.push(urlForView("process", { proc: p.id }))}
            >
              <div className="row">
                <div className="t">{p.unit || "(unit)"}</div>
                <div className="spacer" />
                <span className="pill" style={{ background: hx2rgba(rh, 0.16), color: rh }}>
                  {p.overallRating || "—"}
                </span>
              </div>
              <div className="m">
                {p.sopTitle || p.sopFileName || ""}
                {p.period ? " · " + p.period : ""}
              </div>
              <div className="mini-tiles">
                {tiles.length ? (
                  tiles.map(([c, hex]) => (
                    <span
                      key={c}
                      className="mini-tile"
                      style={{ background: hx2rgba(hex, 0.16), color: hex }}
                    >
                      {counts[c]} {c}
                    </span>
                  ))
                ) : (
                  <span className="hint">No findings</span>
                )}
              </div>
            </div>
          );
        })}
    </>
  );
}
