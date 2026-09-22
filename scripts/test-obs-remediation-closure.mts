import { ok } from "node:assert";
import { obsThread } from "../lib/workspace/observations";
import type { Observation } from "../lib/workspace/types";

console.log("== Scenario Verification: Owner closure comment after rejection ==");

// 1. Observation with owner response that was rejected by Head
const o: Observation = {
  id: "mtskntafq1osy",
  ref: "101.1",
  title: "IT Assets not identified and tagged",
  criticality: "Critical",
  status: "Open",
  owner: "Solomon Aladegolu",
  ownerUserId: "u_solomon",
  ownerResponse: "We have updated the asset register and placed physical tags on all server room assets.",
  ownerResponseEvidence: [
    {
      itemId: "ev_1",
      name: "IT-Asset-Register-2026.xlsx",
      size: 45000,
    },
  ],
  ownerRectifiedAt: "", // Wiped by writeRejection
  ownerRectifiedByName: "", // Wiped by writeRejection
  closureRejection: {
    target: "owner",
    note: "Observation can only be closed after the assets have been properly tagged.",
    byName: "Awa Michael",
    byRole: "head_of_audit",
    at: "2026-09-18T12:00:00Z",
    prevOwnerRectified: {
      byName: "Solomon Aladegolu",
      at: "2026-09-18T10:00:00Z",
    },
  },
};

// 2. Check auditor view (ownerViewer = false, e.g. Mariam Oguche)
const auditorThread = obsThread(o, false);
console.log(`Auditor thread entry count: ${auditorThread.length}`);

const auditorClosure = auditorThread.find((e) => e.tag === "closure");
ok(auditorClosure, "Auditor MUST see owner closure response in thread");
ok(
  auditorClosure.text === "We have updated the asset register and placed physical tags on all server room assets.",
  "Auditor thread includes owner response text",
);
ok(auditorClosure.byName === "Solomon Aladegolu", "Auditor thread attributes owner response to Solomon");
ok(auditorClosure.at === "2026-09-18T10:00:00Z", "Auditor thread preserves owner submission timestamp");
ok(auditorClosure.evidence?.length === 1, "Auditor thread preserves attached evidence file");

const auditorRejection = auditorThread.find((e) => e.tag === "feedback" && e.text?.includes("properly tagged"));
ok(auditorRejection, "Auditor MUST see Head rejection note in thread");
ok(auditorRejection.byName === "Awa Michael", "Rejection note is attributed to Awa Michael");

// 3. Check action owner view (ownerViewer = true)
const ownerThread = obsThread(o, true);
const ownerClosure = ownerThread.find((e) => e.tag === "closure");
ok(ownerClosure, "Owner MUST see their closure response in thread");
ok(ownerClosure.byName === "Solomon Aladegolu", "Owner response is attributed to Solomon");
ok(ownerClosure.at === "2026-09-18T10:00:00Z", "Owner response timestamp is preserved");

// 4. Check IA-only rejection (target === 'auditor') privacy
const oAuditorRej: Observation = {
  ...o,
  closureRejection: {
    target: "auditor",
    note: "Auditor must check server room tags in person.",
    byName: "Awa Michael",
    byRole: "head_of_audit",
    at: "2026-09-18T12:00:00Z",
    prevOwnerRectified: {
      byName: "Solomon Aladegolu",
      at: "2026-09-18T10:00:00Z",
    },
  },
};

const iaThread = obsThread(oAuditorRej, false);
const ownerThread2 = obsThread(oAuditorRej, true);
ok(iaThread.some((e) => e.audience === "ia_only"), "Internal Audit sees ia_only rejection note");
ok(!ownerThread2.some((e) => e.audience === "ia_only"), "Action owner does NOT see ia_only note");

console.log("All scenario verification assertions passed successfully!");
