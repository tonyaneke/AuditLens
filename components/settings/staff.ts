// Shared constants + API helpers for the Settings & user-access domain — ported verbatim
// from public/audit-bot.js (STAFF_DIRECTORY, staffEmail, DEPARTMENTS, roleLabel,
// ASSESSMENT_NAV, loadDirectory/refreshUsersTable fetch contracts).

/** Canonical organisation departments (audit-bot.js DEPARTMENTS). */
export const DEPARTMENTS = [
  "Strategy Department",
  "Credit Operations",
  "Audit Department",
  "Finance Department",
  "Legal Department",
  "People & Culture Department",
  "Risk Management",
  "Procurement Department",
  "Operations Department",
  "Administration Department",
  "Office of the Managing Director",
];

// Credicorp staff list — powers the Name field's autocomplete in the Add user / Action Owner
// modals. [name, job title, AuditLens department]. Emails follow first-initial + surname
// @credicorp.ng. Department placements confirmed by the Head of Audit.
export const STAFF_DIRECTORY: [string, string, string][] = [
  ["Olanike Kolawole", "Executive Director – Operations", "Operations Department"],
  ["Terry Akpata", "Professional - Risk & Compliance", "Risk Management"],
  ["Halima Ahmed", "Intern", "Audit Department"],
  ["Awa Michael", "Head, Internal Audit", "Audit Department"],
  ["Alexander Ehanire", "Head, Strategy & Innovation", "Strategy Department"],
  ["Tubolayefa George", "Specialist - Finance", "Finance Department"],
  ["Boluwatife Inaolaji", "Intern - People Experience", "People & Culture Department"],
  ["Uzoma Nwagba", "Managing Director", "Office of the Managing Director"],
  ["Adanu Ayegba", "Professional - Protocol", "Office of the Managing Director"],
  ["Ziga Paago", "Management Trainee", "People & Culture Department"],
  ["Obiageli Ohakim", "Head, Legal & Company Secretary", "Legal Department"],
  ["Fatima Bello", "Professional - Credit Operations", "Credit Operations"],
  ["Elizabeth Adu", "E.A to the E.D Operations", "Operations Department"],
  ["Jonathan Aderibigbe", "Chief Financial Officer", "Finance Department"],
  ["Eniola Anishe", "Intern - Strategy & Innovation", "Strategy Department"],
  ["Solomon Aladegolu", "Professional - IT", "Strategy Department"],
  ["Peter Esemuede", "Technical Adviser to the MD/CEO & Lead, External Relations", "Office of the Managing Director"],
  ["Emmanuel Okechukwu", "Professional - IT Risk & Compliance", "Risk Management"],
  ["Aisha Abdullahi", "Executive Director – Credit & Portfolio Management", "Credit Operations"],
  ["Chiamaka Ogoh", "Management Trainee", "Strategy Department"],
  ["Wuraola Odubiyi", "Head, Admin, People & Culture", "People & Culture Department"],
  ["Imoh Usoro", "Head, Procurement", "Procurement Department"],
  ["Diekololaoluwa Adewale", "Intern - Legal", "Legal Department"],
  ["Olusola Adetiba", "Professional - People & Culture", "People & Culture Department"],
  ["Dorcas Okolo", "Management Trainee", "Office of the Managing Director"],
  ["Oluwatoyosi Ibinaiye", "Intern - Customer Experience", "People & Culture Department"],
  ["Asari Etuk", "Head, Risk and Compliance", "Risk Management"],
  ["Opeyemi Ayediran", "Professional - Procurement", "Procurement Department"],
  ["Elizabeth Faboyo", "Technical Adviser to the MD/CEO & Lead, Fundraising", "Office of the Managing Director"],
  ["Emmanuel Nwaka", "Lead, Impact & Sustainability", "Operations Department"],
  ["Sadiq Mohammed", "Head, Credit Operations", "Credit Operations"],
  ["Saadatu Alkali", "EA to the ED Credit and Portfolio Mgmt.", "Credit Operations"],
  ["Toyin Olaiya", "Professional - Admin", "Administration Department"],
  ["Najma Goni", "Management Trainee", "Finance Department"],
  ["Beulah Lekwauwa", "Professional - Corporate Counsel", "Legal Department"],
  ["Delight Nwafor", "Professional - Customer Support", "People & Culture Department"],
  ["Michael Ojo", "Professional - Strategic Communications", "Strategy Department"],
  ["Yachat Kanwai", "Management Trainee", "Procurement Department"],
  ["Ladi Amusu", "Chief of Staff", "Office of the Managing Director"],
  ["Peace Oyewumi", "Management Trainee", "Administration Department"],
  ["Tochukwu Chukwuani", "Management Trainee", "Finance Department"],
];

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
  role: string;
  sidebarAccess?: string[];
  photo?: string | null;
  active?: boolean;
  createdAt?: string;
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
