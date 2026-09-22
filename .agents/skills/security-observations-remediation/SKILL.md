---
name: security-observations-remediation
description: Use when analyzing, resolving, verifying, testing, or auditing security observations SEC-01 through SEC-07 in AuditLens (broken access control on data GET/PUT, monolithic document authorization, local auth vs Entra SSO bypasses, CSP and HTTP security headers, optimistic concurrency controls, audit trail logging, and payload size optimization).
---

# Security Observations Remediation (SEC-01 to SEC-07)

## Overview

AuditLens manages sensitive audit universe items, findings, management responses, and executive assurance briefs. In its initial architecture, the application relied on a single monolithic JSON document (`WorkspaceData`) stored in PostgreSQL, with client-side route guards and whole-document updates (`GET` and `PUT` to `/api/data`).

This skill provides the comprehensive runbook for understanding, remediating, and verifying the seven core security findings (SEC-01 through SEC-07) identified during penetration testing and security reviews.

See the complete matrix in [findings-matrix.md](./references/findings-matrix.md).

---

## Quick Reference: The 7 Security Findings

| Finding ID | Severity | OWASP 2021 | Affected Area | Core Remediation Mechanism | Primary Verification |
|---|---|---|---|---|---|
| **SEC-01** | **Critical** | A01 Broken Access Control | `GET /api/data` | Server-side role & department payload scoping via `slimForClient()` and `viewerFor()` | `npx tsx scripts/verify-scope.mts` |
| **SEC-02** | **Critical** | A01 / A04 Insecure Design | `PUT /api/data` | Server-side write reconciliation in `lib/workspace-authz.ts` (controlled fields restored to DB state) | `npx tsx scripts/workspace-authz.test.mts` |
| **SEC-03** | **High** | A07 Auth Failures | `/api/auth/me` & User Schema | Enforce Entra SSO-only; drop vestigial local password columns (`passwordHash`, `mustChangePassword`) | `npx tsx scripts/drop-local-password.mts` |
| **SEC-04** | **Medium** | A05 Misconfiguration | Response Headers & CORS | Nonce-based strict CSP in `proxy.ts`; HSTS, XFO, nosniff in `next.config.ts`; strip ACAO `*` | Header capture / `curl -I` |
| **SEC-05** | **Medium** | A04 Insecure Design | `PUT /api/data` | Enforce optimistic concurrency (`baseUpdatedAt` check -> HTTP 409) + structural body size limits | Stale watermark PUT test |
| **SEC-06** | **Low** | A09 Logging & Monitoring | Audit Log Viewer | Append-only tamper-evident audit logging (`lib/audit-log.ts`) & Head-of-Audit UI (`/audit-log`) | Audit log UI & DB entries |
| **SEC-07** | **Info** | A05 Misconfiguration | Payload Composition | Extract inline base64 photos to `/api/users/[id]/photo` + lightweight `?meta=1` watermark polling | Directory payload size < 5 KB |

---

## Detailed Remediation & Verification Procedures

### SEC-01: Server-Side Authorization for Read (`GET /api/data`)

#### Problem
Client-side `sidebarAccess` guards merely hide navigation elements. An authenticated action owner could invoke `GET /api/data` directly and obtain the full 500 KB+ audit dataset (Executive Brief, fraud risks, cross-department findings, audit universe).

#### Architecture & Solution
- **Visibility Engine:** Defined centrally in `lib/workspace-scope.ts` and `lib/workspace-payload.ts`.
- **Role Tiering:**
  - `head_of_audit`, `audit_staff`, `executive`: Granted full document scope.
  - `action_owner`: Scoped strictly by **department** (using normalized matching in `lib/dept-scope.ts`) and individual assignment.
- **Data Filtering (`slimForClient`):**
  - Withholds non-visible audits and observations.
  - Strips executive summaries, fraud registers, audit universe, IA self-assessments, and department head contact details from non-privileged roles.
- **Handling Role Switching:** Resolves permissions using `effectiveRole` (via `viewerFor(session, data)`) so an administrator impersonating an action owner sees only scoped data.

#### Invariant
> [!IMPORTANT]
> `lib/workspace-scope.ts` and `lib/workspace-authz.ts` **must remain in lockstep**. If `GET` trims a field or record that `PUT` expects to see, an ordinary save will falsely appear as a deletion attempt and flood the audit log with `obs_delete_blocked` false positives.

#### Verification
```bash
# Verify against production document shapes (read-only):
npx tsx scripts/verify-scope.mts

# Or verify offline using a saved snapshot:
npx tsx scripts/verify-scope.mts --file=snapshot.json
```

---

### SEC-02: Server-Side Authorization for Write (`PUT /api/data`)

#### Problem
Because the application persists state in a single document row, incoming PUT requests submit the entire dataset. Without per-record write guards, an attacker can modify finding closure statuses, overwrite audit ratings, or delete entire registers.

#### Architecture & Solution
- **Reconciliation Engine (`lib/workspace-authz.ts`):**
  - Reads stored database state (`current`) and compares against incoming client payload (`incoming`).
  - **Default-Deny for Top-Level Sections:** Non-head roles cannot write `auditUniverse`, `processReviews`, `departments`, `exco*`, `signOff*`, `logo`, etc. Disallowed sections are forced back to stored values.
  - **Three-Way Scope Reconciliation:**
    1. *Visible + Missing* $\to$ Unauthorized deletion attempt: blocked, restored to stored copy, security violation logged.
    2. *Not Visible + Missing* $\to$ Legitimate omission due to SEC-01 scoping: silently merged back from storage (no violation).
    3. *Not Visible + Present* $\to$ Out-of-scope write injection: blocked, logged as `out_of_scope_write`.
  - **Action Owner Permissions:** May only submit updates/comments and mark their own assigned items as "Ready for Closure". Cannot approve, close, or delete findings.
  - **Verification Authority:** Only the lead auditor, the authoring auditor, or the Head of Audit can verify a closure.

#### Verification
```bash
# Run unit and integration authorization tests:
npx tsx scripts/workspace-authz.test.mts
```

---

### SEC-03: Identification & Authentication (SSO Enforcement)

#### Problem
User objects in `/api/auth/me` exposed `mustChangePassword`, implying a dormant or parallel local password login path that would bypass Microsoft Entra ID conditional access and MFA policies.

#### Architecture & Solution
- **SSO Standard:** Internal users authenticate exclusively through Microsoft Entra ID OAuth2 / OIDC (`/api/auth/azure` and `/api/auth/callback`).
- **Eliminate Dead Auth Code:**
  - Removed local password login handlers from production endpoints.
  - User session tokens issued with standard claims, ignoring `mustChangePassword`.
- **Database Column Drop (`User` table):**
  - Columns to remove: `passwordHash`, `mustChangePassword`.
  - Remove `HEAD_AUDIT_PASSWORD` from `.env` and deployment environments.

#### Safe Deployment Procedure
> [!WARNING]
> Prisma selects all scalar columns by default (`findUnique`). If columns are dropped in the database while an older build is still serving traffic, queries will crash. Follow this exact sequence:
1. Deploy code that stops reading `passwordHash` and `mustChangePassword`.
2. Confirm 100% of live traffic is running the updated build.
3. Execute the migration script:
   ```bash
   # Dry-run check:
   npx tsx scripts/drop-local-password.mts

   # Apply column drop:
   npx tsx scripts/drop-local-password.mts --apply
   ```

---

### SEC-04: Security Headers & Content-Security-Policy (CSP)

#### Problem
Missing security headers left the application vulnerable to clickjacking (`X-Frame-Options` / CSP `frame-ancestors`) against sensitive approval workflows, permitted unrestricted script execution (absent CSP), and exposed a permissive CORS wildcard (`Access-Control-Allow-Origin: *`) on the document shell.

#### Architecture & Solution
- **Static Headers (`next.config.ts`):**
  Applied to all routes (`/:path*`):
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: accelerometer=(), camera=(), geolocation=(), ...`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains` (production only)
- **Per-Request Nonce CSP (`proxy.ts`):**
  - Generated per request using crypto nonce:
    ```
    script-src 'self' 'nonce-<RANDOM>' 'strict-dynamic';
    frame-ancestors 'none';
    object-src 'none';
    base-uri 'self';
    ```
  - `style-src` retains `'unsafe-inline'` due to dynamic UI inline styles.
  - Strips any incoming edge `Access-Control-Allow-Origin` wildcard from application responses via `harden()`.

#### Verification
```bash
# Verify headers on document route:
curl -I http://localhost:3000/tracker
# Check that:
# 1. Content-Security-Policy contains 'nonce-' and frame-ancestors 'none'
# 2. X-Frame-Options is DENY
# 3. Access-Control-Allow-Origin is NOT present
```

---

### SEC-05: Concurrency Control & Write Integrity (`PUT /api/data`)

#### Problem
With monolithic whole-document writes, two concurrent users editing different findings overwrite each other's work (last-write-wins). A corrupted or malformed payload can destroy the entire audit database.

#### Architecture & Solution
- **Optimistic Concurrency Control:**
  - Client sends `baseUpdatedAt` in `PUT /api/data` matching the watermark from initial `GET` or `?meta=1`.
  - Server compares `baseUpdatedAt` with stored `WorkspaceData.updatedAt`.
  - If mismatched, server rejects with **HTTP 409 Conflict**:
    ```json
    { "error": "Document has been modified by another user. Please refresh." }
    ```
- **Structural Payload Guards (`lib/workspace-validate.ts`):**
  - Body size capped at `MAX_BODY_BYTES` (8 MB).
  - Enforces array collections and structural shape (`audits`, `observations`, etc.).
  - Strips prototype pollution vectors (`__proto__`, `constructor`, `prototype`).
  - Caps collection lengths (`CAPS.observations = 5000`, etc.) to prevent resource exhaustion.
- **Backup & Recovery:**
  - Automated backups tracked in `lastBackup`.
  - Penetration testing must **never** run destructive write tests against production; always use an isolated staging clone.

---

### SEC-06: Audit Logging & Monitoring

#### Problem
The 'Audit log' button in the user profile menu was disconnected, leaving administrators with no tamper-evident visibility into data changes, role switches, deletions, or governance actions.

#### Architecture & Solution
- **Audit Log Store (`lib/audit-log.ts`):**
  - Backed by the dedicated `AuditLog` table in PostgreSQL.
  - Writes are append-only.
- **Tracked Actions:**
  - Authentication events: `auth.login`, `auth.logout`.
  - User lifecycle: `user.created`, `user.updated`, `user.deactivated`.
  - Data governance: `obs.status_changed`, `obs.closed`, `obs.withdrawn`, `workspace.observation_created`, `data.backup_export`.
  - Security violations: `security.workspace_write_filtered`.
- **UI Viewer (`app/(app)/audit-log/page.tsx`):**
  - Accessible only to Head of Audit (`head_of_audit`).
  - Server-paginated table via `GET /api/audit-log`.
  - Filterable by event category and exportable to Excel/CSV.

---

### SEC-07: Payload Optimization & Asset Segregation

#### Problem
The `/api/directory` endpoint returned base64 data URIs for all user photos, bloating the payload to >100 KB for only 9 users. Furthermore, repeated full-document fetching caused network congestion and cache inefficiency.

#### Architecture & Solution
- **Decoupled Photo Serving:**
  - Stored user photos are served via a dedicated endpoint: `/api/users/[id]/photo`.
  - `photoUrlFor()` generates cacheable image URLs.
  - `/api/directory` returns only user metadata and the photo link, shrinking the response from ~109 KB to < 5 KB.
- **Lightweight Watermark Polling:**
  - Client polls `GET /api/data?meta=1` every 4 seconds.
  - Returns only `{ "updatedAt": "..." }` (~50 bytes) instead of downloading the 500 KB+ workspace document. Full reload occurs only when the watermark changes.

---

## Pentest & Security Verification Checklist

When preparing for or validating a penetration test:

- [ ] **SEC-01:** Log in as an `action_owner`. Inspect `GET /api/data` network response. Verify that ExCo briefs, fraud risks, and unassigned audit findings are absent.
- [ ] **SEC-02:** Attempt to send a crafted `PUT /api/data` changing another department's observation or closing a finding directly as an action owner. Verify the write is reconciled and the audit log records a violation.
- [ ] **SEC-03:** Verify `GET /api/auth/me` returns no `mustChangePassword` or password hashes. Verify no local login route exists.
- [ ] **SEC-04:** Check response headers on `/tracker` and `/api/data`. Verify `Content-Security-Policy` with nonce, `X-Frame-Options: DENY`, `Strict-Transport-Security`, and no wildcard `Access-Control-Allow-Origin`.
- [ ] **SEC-05:** Simulate concurrent writes using stale `baseUpdatedAt`. Verify server returns HTTP 409. Verify payload > 8 MB returns HTTP 413.
- [ ] **SEC-06:** Sign in as Head of Audit, navigate to `/audit-log`, and verify all recent logins and modifications appear with timestamp, actor, and before/after summaries.
- [ ] **SEC-07:** Inspect `/api/directory` network tab. Ensure response is small (< 5 KB) and photos load from `/api/users/.../photo`.
