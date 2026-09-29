import type { WorkspaceDb } from "./db-data";
import { slimForClient } from "./workspace-payload";
import type { Viewer } from "./workspace-scope";

/* Who may download an uploaded file through /api/files/<itemId>.

   A file is reachable only when it is attached to a record the viewer is actually served. The
   check runs over the very document GET /api/data returns to that viewer — tombstones stripped,
   role- and department-scoped by slimForClient() — so read access to a file is exactly read access
   to the record that carries it, and there is no second set of rules to drift. Before this, any
   signed-in user holding (or guessing) an item id could stream any file in the evidence library:
   another department's evidence, Internal Audit's working papers, the fraud register's files.

   The walk is deliberately generic — any object whose `itemId` matches — because evidence lives in
   many shapes (observation attachments and closure files, update threads, external-finding
   responses, audit-test working papers, fraud owner updates and IA validation papers), and a
   per-field list would silently lock out the next surface that adds attachments. */

/** True when an attachment with this `itemId` appears anywhere in `doc`. */
export function referencesFile(doc: unknown, itemId: string): boolean {
  const stack: unknown[] = [doc];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
      continue;
    }
    const o = v as Record<string, unknown>;
    if (o.itemId === itemId) return true;
    for (const x of Object.values(o)) stack.push(x);
  }
  return false;
}

/** Whether this viewer may download the file: it must be attached to a record served to them. */
export function fileVisibleTo(doc: WorkspaceDb, viewer: Viewer, itemId: string): boolean {
  if (!itemId) return false;
  return referencesFile(slimForClient(doc, viewer), itemId);
}
