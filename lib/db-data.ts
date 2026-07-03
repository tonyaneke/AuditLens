export type WorkspaceDb = Record<string, unknown> & {
  org?: string;
  audits?: unknown[];
};

export function defaultWorkspaceData(): WorkspaceDb {
  return {
    org: "Nigerian Consumer Credit Corporation (CREDICORP)",
    signOffName: "Awa Michael",
    signOffTitle: "Head, Internal Audit",
    audits: [],
    auditUniverse: [],
    fraudRisks: [],
    fraudPlanNarrative: "",
    fraudUpdate: { period: "", commentary: "" },
    processReviews: [],
    extFindings: [],
    extCommentary: "",
  };
}

export function mergeById<T extends { id?: string }>(
  target: T[],
  incoming: T[],
): T[] {
  const out = [...(target || [])];
  const idx: Record<string, number> = {};
  out.forEach((x, i) => {
    if (x?.id) idx[x.id] = i;
  });
  (incoming || []).forEach((x) => {
    if (!x) return;
    if (x.id && idx[x.id] != null) out[idx[x.id]] = x;
    else out.push(x);
  });
  return out;
}

export function mergeWorkspaceData(
  current: WorkspaceDb,
  incoming: WorkspaceDb,
): WorkspaceDb {
  const next: WorkspaceDb = { ...current };
  next.audits = mergeById(
    (current.audits as { id?: string }[]) || [],
    (incoming.audits as { id?: string }[]) || [],
  );
  if (incoming.fraudRisks) {
    next.fraudRisks = mergeById(
      (current.fraudRisks as { id?: string }[]) || [],
      (incoming.fraudRisks as { id?: string }[]) || [],
    );
  }
  if (incoming.auditUniverse) {
    next.auditUniverse = mergeById(
      (current.auditUniverse as { id?: string }[]) || [],
      (incoming.auditUniverse as { id?: string }[]) || [],
    );
  }
  if (incoming.processReviews) {
    next.processReviews = mergeById(
      (current.processReviews as { id?: string }[]) || [],
      (incoming.processReviews as { id?: string }[]) || [],
    );
  }
  if (incoming.extFindings) {
    next.extFindings = mergeById(
      (current.extFindings as { id?: string }[]) || [],
      (incoming.extFindings as { id?: string }[]) || [],
    );
  }
  if (!next.fraudPlanNarrative && incoming.fraudPlanNarrative) {
    next.fraudPlanNarrative = incoming.fraudPlanNarrative;
  }
  if (incoming.org) next.org = incoming.org;
  if (incoming.signOffName) next.signOffName = incoming.signOffName;
  if (incoming.signOffTitle) next.signOffTitle = incoming.signOffTitle;
  if (incoming.planYear) next.planYear = incoming.planYear;
  if (incoming.logo) next.logo = incoming.logo;
  if (incoming.lastBackup) next.lastBackup = incoming.lastBackup;
  if (incoming.extCommentary) next.extCommentary = incoming.extCommentary;
  if (incoming.iaSA) next.iaSA = incoming.iaSA;
  return next;
}
