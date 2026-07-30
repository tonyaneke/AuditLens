import type { WorkspaceDb } from "./db-data";
import { isHead, scopeWorkspace, type Viewer } from "./workspace-scope";

type AnyRec = Record<string, unknown>;

/* The two halves of the /api/data payload contract, kept together because they are inverses.
 * Anything slimForClient() withholds on GET, graftServerHeld() must restore on PUT — otherwise a
 * whole-document save deletes data the client was never sent. Extracted from the route handler
 * so scripts/verify-scope.mts can measure the real payload rather than an approximation of it. */

// The stored SOP PDFs (processReviews[].sopPdfBase64) are by far the heaviest part of the
// workspace document (~1.1 MB of 1.7 MB stored). They stay server-side: GET replaces each with a
// sopPdfStored flag, and PUT grafts the stored base64 back so a client save never loses them.
export function slimForClient(data: WorkspaceDb, viewer: Viewer): WorkspaceDb {
  /* SEC-01 — role scoping first: an action owner never receives another department's
     observations, the fraud register, the audit universe or the approvals queue at all. Head of
     Audit and audit staff get the document unchanged and fall through to the trims below.
     lib/workspace-scope.ts is shared with the write path — see the note there. */
  let out = scopeWorkspace(data, viewer);

  const reviews = out.processReviews as AnyRec[] | undefined;
  if (reviews && reviews.some((r) => r && typeof r === "object" && r.sopPdfBase64)) {
    out = {
      ...out,
      processReviews: reviews.map((r) => {
        if (!r || typeof r !== "object" || !r.sopPdfBase64) return r;
        const { sopPdfBase64: _dropped, ...rest } = r;
        void _dropped;
        return { ...rest, sopPdfStored: true };
      }),
    };
  }

  /* QA-7 — notifications are addressed to a single user, and every read path already filters
     with myNotifications(db, user.id). The whole list was still being sent to everyone: ~35 KB
     of payload that no client uses, and every user could read every other user's notification
     text, which quotes observation titles they may have no business seeing. Filtered here;
     graftServerHeld() below puts the other users' rows back on write so a save cannot drop
     them by omission. */
  const notifs = out.notifications as AnyRec[] | undefined;
  if (Array.isArray(notifs) && notifs.length) {
    out = {
      ...out,
      notifications: notifs.filter((n) => String(n?.userId || "") === viewer.id),
    } as WorkspaceDb;
  }

  /* exco.briefs[].token is the credential for /brief?id=<token>, a PUBLIC, unauthenticated
     route (it is in proxy.ts PUBLIC_PATHS). Shipping every token to every signed-in user meant
     any action owner could mint a shareable link to the Board assurance brief and send it
     outside the organisation. Only the Head of Audit, who issues the briefs, needs them. */
  const exco = out.exco as AnyRec | undefined;
  if (!isHead(viewer) && exco && Array.isArray(exco.briefs)) {
    out = {
      ...out,
      exco: {
        ...exco,
        briefs: (exco.briefs as AnyRec[]).map((b) => {
          if (!b || !b.token) return b;
          const { token: _withheld, ...rest } = b;
          void _withheld;
          return rest;
        }),
      },
    } as WorkspaceDb;
  }

  return out;
}

/** Restore everything slimForClient() withheld, so a whole-document save cannot delete data the
 *  client was never sent. Anything trimmed on GET must be grafted back here. */
export function graftServerHeld(current: WorkspaceDb, next: WorkspaceDb, userId: string): WorkspaceDb {
  let out = next;

  const nextReviews = out.processReviews as AnyRec[] | undefined;
  if (nextReviews && nextReviews.length) {
    const curReviews = (current.processReviews as AnyRec[] | undefined) || [];
    const byId = new Map(
      curReviews
        .filter((r) => r && typeof r === "object" && r.id)
        .map((r) => [String(r.id), r]),
    );
    out = {
      ...out,
      processReviews: nextReviews.map((r) => {
        if (!r || typeof r !== "object" || r.sopPdfBase64) return r; // fresh upload rides in
        const cur = byId.get(String(r.id));
        if (cur && cur.sopPdfBase64)
          return { ...r, sopPdfBase64: cur.sopPdfBase64, sopPdfStored: true };
        return r;
      }),
    };
  }

  /* Notifications: the client only ever received its own, so anything stored for someone else is
     server-held and must survive this write. A client legitimately creates notifications
     addressed to other people (assigning an owner, requesting an approval), and marks its own as
     read — both of which reconcileNotifications() in lib/workspace-authz.ts has already vetted by
     the time we get here.

     Stored rows are seeded FIRST and the reconciled rows layered on top, but a stored row
     belonging to another user is never replaced: previously an incoming row won on id collision
     for everyone, which let a caller rewrite the text, link or read state of a notification
     addressed to somebody else. */
  const incoming = (out.notifications as AnyRec[] | undefined) || [];
  const stored = (current.notifications as AnyRec[] | undefined) || [];
  const merged = new Map<string, AnyRec>();
  const foreign = new Set<string>();
  for (const n of stored) {
    if (!n || !n.id) continue;
    if (String(n.userId || "") !== userId) {
      merged.set(String(n.id), n);
      foreign.add(String(n.id));
    }
  }
  for (const n of incoming) {
    if (!n || !n.id) continue;
    if (foreign.has(String(n.id))) continue; // someone else's row — stored value stands
    merged.set(String(n.id), n);
  }
  out = { ...out, notifications: [...merged.values()] } as WorkspaceDb;

  /* Brief tokens are withheld from non-heads above, so a non-head save arrives without them.
     Restore from storage — losing a token would silently break every public brief link that has
     already been circulated to the MD and EXCO. */
  const nextExco = out.exco as AnyRec | undefined;
  const curExco = current.exco as AnyRec | undefined;
  if (nextExco && Array.isArray(nextExco.briefs) && curExco && Array.isArray(curExco.briefs)) {
    const tokenById = new Map(
      (curExco.briefs as AnyRec[])
        .filter((b) => b && b.id && b.token)
        .map((b) => [String(b.id), b.token]),
    );
    out = {
      ...out,
      exco: {
        ...nextExco,
        briefs: (nextExco.briefs as AnyRec[]).map((b) => {
          if (!b || b.token) return b; // a freshly generated brief brings its own
          const stored = tokenById.get(String(b.id));
          return stored ? { ...b, token: stored } : b;
        }),
      },
    } as WorkspaceDb;
  }

  return out;
}
