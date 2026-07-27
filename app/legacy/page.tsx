// Back-compat only: every view now lives at its clean URL (unmigrated ones mount the legacy
// shell there). Stale /legacy?view=x bookmarks and old notification links land here and get
// forwarded to the clean equivalent.
import { redirect } from "next/navigation";
import { urlForView, type ViewKey, type ViewOpts } from "@/lib/routes";

type Search = Record<string, string | string[] | undefined>;

export default async function LegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const s = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const view = (s("view") as ViewKey) || "dashboard";
  const opts: ViewOpts = {
    audit: s("audit"),
    report: s("report"),
    obs: s("obs"),
    ext: s("ext"),
    unit: s("unit"),
    fraud: s("fraud"),
    proc: s("proc"),
    mode: s("mode"),
    tab: s("tab"),
  };
  let url = "/";
  try {
    url = urlForView(view, opts) || "/";
  } catch {
    url = "/";
  }
  if (view === "audits" && s("new")) url = "/audits/new";
  if (url.includes("undefined")) url = "/";
  redirect(url);
}
