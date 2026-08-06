// Shared constants + API helpers for the Settings & user-access domain — ported verbatim
// from public/audit-bot.js (STAFF_DIRECTORY, staffEmail, DEPARTMENTS, roleLabel,
// ASSESSMENT_NAV, loadDirectory/refreshUsersTable fetch contracts).

/* Canonical organisation departments, as confirmed by the Head of Audit on 2026-08-06.
   This IS an access-control list now, not a set of labels: an action owner sees every internal
   observation raised against the department named here (see lib/dept-scope.ts), so a department
   that is spelled a new way is a department nobody can see into.

   Changed from the original audit-bot.js list: IT, Impact & Sustainability and Corporate
   Communications are departments in their own right, and Operations is retired as a staffed
   department (its lead and his EA moved to Impact & Sustainability).

   The SPELLINGS here are the ones the Head of Audit confirmed on 2026-08-06 as the proper names —
   "Finance" not "Finance & Accounts", "Administration Department" not "Administration",
   "People & Culture Department" not "People & Culture", "Corporate Communications" not
   "Strategic Comms". Every variant that has been used along the way is aliased in
   lib/dept-scope.ts, so which spelling a record was raised under never affects who can see it;
   this list decides only what is displayed and offered in the Settings dropdown. */
export const DEPARTMENTS = [
  "Administration Department",
  "Corporate Communications",
  "Credit Operations",
  "Finance",
  "Impact & Sustainability",
  "Internal Audit",
  "IT",
  "Legal",
  "Office of the Managing Director",
  "People & Culture Department",
  "Procurement",
  "Risk Management",
  "Strategy",
];

/* Credicorp staff list — powers the Name field's autocomplete in the Add user / Action Owner
   modals. [name, job title, AuditLens department]. Emails follow first-initial + surname
   @credicorp.ng.

   This is the organisation's department roster as at 2026-08-06 and it is what
   scripts/apply-department-roster.mts applies to the live accounts, so the two cannot drift.

   NOT IN THE ROSTER, deliberately:
     · the MD and the two EDs (Uzoma Nwagba, Aisha Abdullahi, Olanike Kolawole) receive the Board
       assurance brief as a tokenised link and hold no account — see scripts/verify-backlog.mts;
     · four people were removed from AuditLens on 2026-08-06 (Eniola Anishe, Diekololaoluwa
       Adewale, Boluwatife Inaolaji, Oluwatoyosi Ibinaiye);
     · Halima Ahmed keeps her Internal Audit staff account but is not an action owner, so she is
       listed here for the autocomplete and takes no department scope from it. */
export const STAFF_DIRECTORY: [string, string, string][] = [
  ["Toyin Olaiya", "Professional - Admin", "Administration Department"],
  ["Delight Nwafor", "Professional - Customer Support", "Administration Department"],
  ["Peace Oyewumi", "Management Trainee", "Administration Department"],
  ["Wuraola Odubiyi", "Head, Admin, People & Culture", "Administration Department"],
  ["Sadiq Mohammed", "Head, Credit Operations", "Credit Operations"],
  ["Sussan Omiete", "Professional - Credit Operations", "Credit Operations"],
  ["Fatima Mustafa Bello", "Professional - Credit Operations", "Credit Operations"],
  ["Saadatu Alkali", "EA to the ED Credit and Portfolio Mgmt.", "Credit Operations"],
  ["Jonathan Aderibigbe", "Chief Financial Officer", "Finance"],
  ["Tubolayefa George", "Specialist - Finance", "Finance"],
  ["Najma Goni", "Management Trainee", "Finance"],
  ["Tochukwu Chukwuani", "Management Trainee", "Finance"],
  ["Emmanuel Nwaka", "Lead, Impact & Sustainability", "Impact & Sustainability"],
  ["Elizabeth Adu", "E.A to the E.D Operations", "Impact & Sustainability"],
  ["Awa Michael", "Head, Internal Audit", "Internal Audit"],
  ["Halima Ahmed", "Intern", "Internal Audit"],
  ["Solomon Aladegolu", "Professional - IT", "IT"],
  ["Chiamaka Ogoh", "Management Trainee", "IT"],
  ["Obiageli Vera Ohakim", "Head, Legal & Company Secretary", "Legal"],
  ["Beulah Lekwauwa", "Professional - Corporate Counsel", "Legal"],
  ["Elizabeth Faboyo", "Technical Adviser to the MD/CEO & Lead, Fundraising", "Office of the Managing Director"],
  ["Peter Esemuede", "Technical Adviser to the MD/CEO & Lead, External Relations", "Office of the Managing Director"],
  ["Ladi Amusu", "Chief of Staff", "Office of the Managing Director"],
  ["Dorcas Okolo", "Management Trainee", "Office of the Managing Director"],
  ["Adanu Ayegba", "Professional - Protocol", "Office of the Managing Director"],
  ["Olusola Adetiba", "Professional - People & Culture", "People & Culture Department"],
  ["Ziga Paago", "Management Trainee", "People & Culture Department"],
  ["Imoh Usoro", "Head, Procurement", "Procurement"],
  ["Opeyemi Ayediran", "Professional - Procurement", "Procurement"],
  ["Yachat Kanwai", "Management Trainee", "Procurement"],
  ["Asari Etuk", "Head, Risk and Compliance", "Risk Management"],
  ["Terry Akpata", "Professional - Risk & Compliance", "Risk Management"],
  ["Emmanuel Okechukwu", "Professional - IT Risk & Compliance", "Risk Management"],
  ["Michael Ojo", "Professional - Strategic Communications", "Corporate Communications"],
  ["Alexander Ehanire", "Head, Strategy & Innovation", "Strategy"],
  ["Anthony Aneke", "Professional - Innovation", "Strategy"],
  // TEMPORARY (added back 2026-08-06, having been removed the same day). Delete this line and
  // re-run scripts/apply-department-roster.mts --apply to withdraw the access again — the roster
  // is what the script removes against, so nothing else needs touching.
  ["Eniola Anishe", "Intern - Strategy & Innovation", "Strategy"],
];

/* The two people who genuinely straddle two departments. Both halves confer identical access —
   the split into a home department plus extras exists only so one field stays a single value for
   display. See `extraDepartments` in prisma/schema.prisma. */
export const STAFF_EXTRA_DEPARTMENTS: Record<string, string[]> = {
  "Wuraola Odubiyi": ["People & Culture Department"],
  "Ladi Amusu": ["Corporate Communications"],
};

/** first-initial + surname @credicorp.ng (audit-bot.js staffEmail). */
export function staffEmail(name: string): string {
  const parts = String(name || "").trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return "";
  return (parts[0][0] + parts[parts.length - 1]).replace(/[^a-z]/g, "") + "@credicorp.ng";
}

/** Exact-name staff match for the autocomplete auto-fill (applyStaffPick / applyStaffPickDept). */
export function staffPick(name: string): [string, string, string] | undefined {
  const n = String(name || "").trim().toLowerCase();
  return STAFF_DIRECTORY.find(([x]) => x.toLowerCase() === n);
}

/** QA-14 — re-exported from lib/permissions so there is one role→label map, not six. */
export { roleLabel } from "@/lib/permissions";

/** Sidebar sections a Head of Audit can grant to audit staff (audit-bot.js ASSESSMENT_NAV). */
export const ASSESSMENT_NAV: [string, string][] = [
  ["auditra", "Audit Risk Assessment"],
  ["fraud", "Fraud Risk"],
  ["process", "Process Review"],
  ["external", "External Findings"],
  ["iasa", "IA Self-Assessment"],
];

/* ---------------- API contracts (unchanged from legacy) ---------------- */
// The user directory cache lives in lib/client/directory.ts (shared with other domains).

/** Row from GET /api/users (head-only management list — legacy _usersCache). */
export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  department?: string;
  /** Further departments this person belongs to — see `extraDepartments` in prisma/schema.prisma. */
  extraDepartments?: string[];
  role: string;
  sidebarAccess?: string[];
  photo?: string | null;
  active?: boolean;
  createdAt?: string;
  /** null until the "your account is ready" email has gone out — see PATCH /api/users/:id. */
  welcomeEmailSentAt?: string | null;
};

export async function fetchUsers(): Promise<ManagedUser[] | null> {
  try {
    const res = await fetch("/api/users");
    if (!res.ok) return null;
    const json = await res.json();
    return json.users || [];
  } catch {
    return null;
  }
}
