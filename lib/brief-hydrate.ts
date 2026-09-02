/* Rebuild full brief detail pages from live workspace data — so older brief snapshots (saved
   before rich detail fields were stored) still render the same view an action owner sees. */

import {
  mapBriefExtDetail,
  mapBriefFraudDetail,
  mapBriefIssueDetail,
  type BriefExtDetail,
  type BriefFraudDetail,
  type BriefIssueDetail,
} from "./brief-detail-map";
import { computeExcoSnapshot } from "./exco-compute";
import type { ExtFinding, Observation } from "@/lib/workspace/types";

type WorkspaceData = {
  audits?: Audit[];
  departments?: unknown[];
  users?: Array<{ id?: string; name?: string }>;
  fraudRisks?: Array<Record<string, unknown>>;
  extFindings?: Array<Record<string, unknown>>;
};

type BriefSnapshot = {
  period?: string;
  headline?: string;
  commentary?: string;
  keyIssues?: Array<{ title?: string; audit?: string; area?: string; owner?: string; scheme?: string }>;
  repeats?: Array<{ title?: string; audit?: string; owner?: string }>;
  fraud?: Array<{ scheme?: string; owner?: string }>;
  ext?: Array<{ title?: string; source?: string; owner?: string }>;
  themes?: Array<[string, number]>;
};

type Audit = { name?: string; area?: string; reports?: Array<{ observations?: Observation[]; reportDateISO?: string; reportDate?: string }> };

export type BriefView = "issue" | "repeat" | "fraud" | "external" | "theme";

function norm(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function auditMatches(hintAudit: string, hintArea: string, auditName: string) {
  const a = norm(hintAudit);
  const area = norm(hintArea);
  const name = norm(auditName);
  if (!a && !area) return true;
  if (a && (a === name || area.startsWith(name) || a.startsWith(name))) return true;
  if (area && area.includes(name)) return true;
  return false;
}

function findObservation(
  data: WorkspaceData,
  hint: { title?: string; audit?: string; area?: string; owner?: string },
  requireAudit = true,
): BriefIssueDetail | null {
  const title = norm(hint.title);
  if (!title) return null;
  const hintOwner = norm(hint.owner);
  for (const a of data.audits || []) {
    if (requireAudit && !auditMatches(hint.audit || "", hint.area || "", a.name || "")) continue;
    for (const r of a.reports || []) {
      for (const o of r.observations || []) {
        if (norm(o.title) !== title) continue;
        if (hintOwner && norm(o.owner) !== hintOwner) continue;
        return mapBriefIssueDetail(o as Observation, a, r, data);
      }
    }
  }
  if (requireAudit) return findObservation(data, hint, false);
  return null;
}

function findFraud(data: { fraudRisks?: Array<Record<string, unknown>> }, hint: { scheme?: string; owner?: string }) {
  const scheme = norm(hint.scheme);
  if (!scheme) return null;
  const hintOwner = norm(hint.owner);
  for (const f of data.fraudRisks || []) {
    if (norm(f.scheme) !== scheme) continue;
    if (hintOwner && norm(f.owner) !== hintOwner) continue;
    return mapBriefFraudDetail(f);
  }
  return null;
}

function findExternal(data: WorkspaceData, hint: { title?: string; source?: string; owner?: string }) {
  const title = norm(hint.title);
  if (!title) return null;
  const hintSource = norm(hint.source);
  const hintOwner = norm(hint.owner);
  for (const f of data.extFindings || []) {
    if (norm(f.title) !== title && norm(f.ref) !== title) continue;
    if (hintSource && norm(f.source) !== hintSource) continue;
    if (hintOwner && norm(f.owner) !== hintOwner) continue;
    return mapBriefExtDetail(f as ExtFinding, data);
  }
  return null;
}

function liveSnapshot(data: unknown, snap: BriefSnapshot) {
  return computeExcoSnapshot(data, {
    period: snap.period,
    headline: snap.headline,
    commentary: snap.commentary,
  });
}

function pickByIndex<T>(list: T[] | undefined, index: number) {
  return list && index >= 0 && index < list.length ? list[index] : null;
}

/** Full detail for a brief row — prefers live workspace lookup, falls back to recomputed lists. */
export function hydrateBriefDetailItem(
  view: BriefView,
  index: number,
  snapshot: BriefSnapshot,
  data: unknown,
): BriefIssueDetail | BriefFraudDetail | BriefExtDetail | [string, number] | null {
  const d = data as WorkspaceData;

  if (view === "theme") {
    return pickByIndex(snapshot.themes, index) || pickByIndex(liveSnapshot(d, snapshot).themes, index);
  }

  const live = liveSnapshot(d, snapshot);

  if (view === "issue") {
    const hint = snapshot.keyIssues?.[index];
    if (!hint) return null;
    return findObservation(d, hint) || pickByIndex(live.keyIssues, index);
  }

  if (view === "repeat") {
    const hint = snapshot.repeats?.[index];
    if (!hint) return null;
    return findObservation(d, hint) || pickByIndex(live.repeats, index);
  }

  if (view === "fraud") {
    const hint = snapshot.fraud?.[index];
    if (!hint) return null;
    return findFraud(d, hint) || pickByIndex(live.fraud, index);
  }

  if (view === "external") {
    const hint = snapshot.ext?.[index];
    if (!hint) return null;
    return findExternal(d, hint) || pickByIndex(live.ext, index);
  }

  return null;
}
