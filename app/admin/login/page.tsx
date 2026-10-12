import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { adminLoginEnabled } from "@/lib/admin-credential";
import AdminLoginForm from "./AdminLoginForm";

export const metadata: Metadata = {
  title: "Admin sign-in · AuditLens",
  robots: { index: false, follow: false },
};

/* The Admin profile's password sign-in (lib/admin-credential.ts). Not linked from anywhere: staff
   sign in with Microsoft at /login, and this page is for the one account that cannot. */
export default async function AdminLoginPage() {
  // Read the switch per request, not at build time — turning it off must take effect without a rebuild.
  await connection();
  if (!adminLoginEnabled()) notFound();
  return <AdminLoginForm />;
}
