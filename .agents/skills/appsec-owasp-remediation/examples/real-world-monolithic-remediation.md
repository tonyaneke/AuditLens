# Case Study: Monolithic State Architecture Remediation (SEC-01 to SEC-07)

This case study illustrates how the OWASP Top 10 principles apply to a real-world enterprise application (AuditLens) that started with a monolithic JSON document state model (`WorkspaceData`) and successfully remediated 7 critical/high findings without requiring an immediate database overhaul.

---

## The System Under Review

- **Stack:** Next.js (App Router), React, PostgreSQL via Prisma, Microsoft Entra ID SSO.
- **Initial State:**
  - Entire application state stored as one multi-megabyte JSON blob in a single database row.
  - `GET /api/data`: Returns the entire document to any authenticated caller. Client sidebar hides unauthorized tabs.
  - `PUT /api/data`: Client sends back the complete modified document on every save.
  - Concurrency: Naive Last-Write-Wins (LWW) with no version token.
  - Auth: Microsoft Entra SSO in use, but legacy `mustChangePassword` and `passwordHash` columns lingered in the `User` schema.
  - Headers: Missing CSP, missing frame protection, wildcard CORS on HTML document.

---

## Finding-by-Finding Breakdown & Applied Patterns

### 1. SEC-01: Broken Access Control on Read (`GET /api/data`)
- **OWASP Category:** A01:2021 – Broken Access Control
- **Severity:** Critical
- **Vulnerability:** Bypassing the UI allowed any action owner to view the entire audit universe, fraud risks, and confidential executive briefings.
- **Remediation Pattern (Server-Side Scope Filtering):**
  - Implemented `viewerFor(session, data)` and `slimForClient(data, viewer)`.
  - Scoped by role first (Audit leadership retains org-wide view; action owners are scoped to their department and assigned items).
  - Department matching accounts for aliases (case- and suffix-insensitive matching).
  - Strips executive summaries, unapproved observations, fraud registers, and contact info from lower-privilege users.

---

### 2. SEC-02: Broken Access Control on Write (`PUT /api/data`)
- **OWASP Category:** A01:2021 – Broken Access Control / A04:2021 – Insecure Design
- **Severity:** Critical
- **Vulnerability:** Whole-document PUT allowed clients to write back modified closure statuses, sign-offs, or delete records directly.
- **Remediation Pattern (Reconciliation Engine with Default-Deny):**
  - Server-side reconciliation in `authorizeWorkspaceWrite()`:
    1. Compares incoming payload with stored database record.
    2. Locked sections (`auditUniverse`, `exco`, `departments`, `branding`) forced back to DB values for non-head users.
    3. Handles three omission states:
       - *Visible + Missing:* Treated as an unauthorized deletion attempt $\to$ restored, violation logged.
       - *Not Visible + Missing:* Legitimate omission due to SEC-01 scoping $\to$ preserved silently from stored state.
       - *Not Visible + Present:* Tampering / out-of-scope injection $\to$ blocked, violation logged.
    4. Action owners restricted to remediation fields and "Ready for Closure" status transitions.

---

### 3. SEC-03: Identification & Authentication Bypass (Shadow Local Auth)
- **OWASP Category:** A07:2021 – Identification and Authentication Failures
- **Severity:** High
- **Vulnerability:** `mustChangePassword` and `passwordHash` attributes in `/api/auth/me` indicated dormant password authentication that could circumvent Entra ID MFA and conditional access.
- **Remediation Pattern (SSO Hardening & Safe Schema Deprecation):**
  - Confirmed Microsoft Entra ID is the sole authentication authority.
  - Phased schema cleanup: deployed code that stopped reading the password columns, verified stability, then executed non-blocking DDL to drop `passwordHash` and `mustChangePassword`.
  - Removed `HEAD_AUDIT_PASSWORD` from environment configs.

---

### 4. SEC-04: Security Misconfiguration (Headers & CORS)
- **OWASP Category:** A05:2021 – Security Misconfiguration
- **Severity:** Medium
- **Vulnerability:** Lack of `X-Frame-Options` allowed clickjacking on approval workflows; absence of CSP permitted arbitrary script injection; wildcard CORS on the app shell.
- **Remediation Pattern (Dual-Layer Edge/Middleware Defense):**
  - **Static Headers (`next.config.ts`):** Enforced `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and HSTS with 2-year `max-age`.
  - **Dynamic CSP (`proxy.ts`):** Generated a cryptographic nonce per request for `script-src 'self' 'nonce-...' 'strict-dynamic'` and `frame-ancestors 'none'`.
  - Stripped edge-injected wildcard CORS headers on app responses.

---

### 5. SEC-05: Insecure Design & Concurrency (Data Integrity)
- **OWASP Category:** A04:2021 – Insecure Design
- **Severity:** Medium
- **Vulnerability:** Concurrent edits silently overwrote each other (LWW); a corrupted whole-document payload could wipe the entire audit history.
- **Remediation Pattern (Optimistic Concurrency & Structural Guards):**
  - Enforced `baseUpdatedAt` watermark validation on `PUT /api/data`. If mismatched with database `updatedAt`, rejected with HTTP 409 Conflict.
  - Added structural payload validation and body size caps (`MAX_BODY_BYTES = 8 MB`).
  - Implemented containment caps (e.g. max observations) and stripped prototype pollution keys (`__proto__`, `constructor`, `prototype`).

---

### 6. SEC-06: Security Logging & Monitoring Failures
- **OWASP Category:** A09:2021 – Security Logging and Monitoring Failures
- **Severity:** Low
- **Vulnerability:** Inactive "Audit log" button prevented administrators from reviewing attribution and modification history.
- **Remediation Pattern (Append-Only Tamper-Evident Audit Trail):**
  - Created dedicated `AuditLog` table with append-only semantics.
  - Captured mutations (observation state changes, verifications, deletions, backups, and security write violations).
  - Built a Head-of-Audit UI viewer at `/audit-log` with server-side pagination and CSV export.

---

### 7. SEC-07: Payload Composition & Information Disclosure
- **OWASP Category:** A05:2021 – Security Misconfiguration / Performance
- **Severity:** Info
- **Vulnerability:** Inlined base64 user avatars bloated the directory payload to >100 KB; full document re-fetched redundantly.
- **Remediation Pattern (Asset Segregation & Watermark Polling):**
  - Extracted photos to a dedicated endpoint `/api/users/[id]/photo` with client caching.
  - Implemented `GET /api/data?meta=1` lightweight polling (~50 bytes) to check for updates before re-fetching the full document.
