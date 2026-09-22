# OWASP Top 10 (2021) & API Security Top 10 (2023) Master Reference

This guide provides deep technical analysis, attack mechanics, defensive architectures, and verification strategies for modern web applications and APIs.

---

## 1. A01:2021 – Broken Access Control (BAC) & API1:2023 – BOLA / BFLA

### Mechanics
Broken Access Control occurs when application enforcement fails to ensure that a user can only perform actions or access data within their permitted boundary.
- **BOLA (Broken Object Level Authorization / Insecure Direct Object References - IDOR):** Caller modifies an ID (e.g. `/api/orders/1024` $\to$ `/api/orders/1025`) to access another user's or department's private resource.
- **BFLA (Broken Function Level Authorization):** Low-privilege user accesses administrative functions by invoking endpoints directly (e.g. `POST /api/admin/reset`), bypassing UI navigation restrictions.
- **Monolithic State Leakage:** An API returns an entire organizational entity graph (`GET /api/data`), relying on client-side routing or UI component hiding to "protect" sensitive tabs or records.

### Root Causes
1. **Client-Side Security Fallacy:** Relying on UI route guards, conditional tab rendering, or hidden buttons as security boundaries.
2. **Missing Ownership Verification:** Inspecting only authentication (is the user logged in?) rather than authorization (does this user own this specific record or belong to this department?).
3. **Coarse-Grained / Monolithic Endpoints:** Serving composite datasets containing multiple domain entities with different clearance levels in one response.

### Remediation Blueprint
- **Default-Deny Rule:** Invert endpoint authorization. Unless explicitly granted to the user's role or organization scope, access is rejected.
- **Server-Side Context Scoping (`slimForClient` pattern):**
  ```typescript
  // 1. Resolve viewer identity and clearance
  const viewer = resolveViewer(session);

  // 2. Query or filter strictly by resolved boundary
  const data = filterByScope(storedData, viewer);
  ```
- **Record-Level Ownership Checks on Writes:**
  Before updating, verify that:
  `resource.tenantId === session.tenantId && (resource.ownerId === session.userId || session.roles.includes('admin'))`
- **Reconciliation Engine for Bulk/Monolithic Writes:**
  If the application legacy requires a bulk write, the server must reconstruct the document against the stored copy, permitting changes *only* to records and fields the caller is authorized to modify. Disallowed changes must be reverted and logged as security violations.

---

## 2. A02:2021 – Cryptographic Failures & Sensitive Data Exposure

### Mechanics
Exposure of sensitive data (PII, credentials, business-critical records) due to absent, weak, or improperly implemented cryptographic controls in transit or at rest.

### Common Failure Modes
1. **Cleartext Transmission:** HTTP instead of HTTPS, missing HSTS, or weak TLS cipher suites.
2. **Weak Hashing of Secrets:** Using MD5, SHA-1, or unsalted SHA-256 for passwords instead of memory-hard functions (Argon2id, bcrypt, PBKDF2).
3. **Vestigial Sensitive Fields in Databases:** Leaving unused password hashes, temporary tokens, or plaintext secrets in active database tables.
4. **Information Bleed in Token Claims:** Storing unencrypted sensitive user attributes inside client-accessible JWTs.

### Remediation Blueprint
- **Enforce TLS 1.3 & HSTS:** Configure `Strict-Transport-Security: max-age=63072000; includeSubDomains` on all production responses.
- **Adopt Argon2id / bcrypt:** For any credential storage, enforce work factor $\ge 12$ (bcrypt) or standard Argon2id memory limits.
- **Safe Schema Deprecation Procedure:**
  When eliminating legacy credential fields:
  1. *Phase 1:* Deploy application code that ceases reading or writing the columns.
  2. *Phase 2:* Verify zero runtime dependency across all instances/replicas.
  3. *Phase 3:* Execute non-blocking DDL (`ALTER TABLE ... DROP COLUMN`).

---

## 3. A03:2021 – Injection & Prototype Pollution

### Mechanics
Untrusted data is sent to an interpreter as part of a command or query, or merged into object prototypes, leading to execution of unintended instructions or property spoofing.

### Common Vectors
1. **SQL / NoSQL Injection:** String concatenation in SQL statements or unvalidated query filters (e.g. `{"username": {"$gt": ""}}`).
2. **Object Prototype Pollution (JavaScript/TypeScript):** Merging user-controlled JSON payloads into objects using recursive `Object.assign` or clone utilities, allowing injection of keys like `__proto__`, `constructor`, or `prototype`.
3. **Command Injection:** Passing unsanitized input to child processes (`exec`, `spawn`).

### Remediation Blueprint
- **Parameterized Queries / Type-Safe ORMs:** Use Prisma, TypeORM, or parameterized SQL (`$1, $2`). Never interpolate raw strings into query builders.
- **Prototype Pollution Guards:**
  Always validate or sanitize incoming JSON objects before spreading or cloning:
  ```typescript
  const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  function sanitizeKeys(obj: Record<string, unknown>) {
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(key)) delete obj[key];
    }
  }
  ```
- **Context-Aware Output Encoding:** Use frameworks that encode HTML by default (React/JSX), and avoid raw HTML injection sinks (`dangerouslySetInnerHTML`, `v-html`).

---

## 4. A04:2021 – Insecure Design & Concurrency Flaws (API3:2023)

### Mechanics
Flaws resulting from missing or ineffective control design, architectural race conditions, or unconstrained resource utilization.

### Critical Focus: Concurrency & Last-Write-Wins (LWW)
In applications where records or documents can be edited concurrently:
1. User A loads record at $T_0$.
2. User B loads record at $T_0$.
3. User A edits field $X$ and saves at $T_1$.
4. User B edits field $Y$ and saves at $T_2$, submitting the snapshot from $T_0$.
5. **Impact:** User A's changes to $X$ are silently obliterated.

### Remediation Blueprint: Optimistic Concurrency Control (OCC)
- Require an `If-Match` header or a watermark token (`baseUpdatedAt` / `version` / `etag`):
  ```typescript
  if (storedRow.updatedAt.toISOString() !== body.baseUpdatedAt) {
    return NextResponse.json(
      { error: "Conflict: document has been modified by another user. Please refresh." },
      { status: 409 }
    );
  }
  ```
- **Payload & Rate Constraints:**
  - Cap request body sizes server-side before memory buffering (`MAX_BODY_BYTES`, e.g. 8 MB).
  - Enforce collection item caps (e.g. max 5,000 observations) to prevent denial of service through memory exhaustion.
- **Safe Pentest Isolation:** Destructive tests (concurrent bulk overwrites, corruption fuzzing) must always be executed against verified staging clones, never on production datasets.

---

## 5. A05:2021 – Security Misconfiguration & Edge Hardening

### Mechanics
Incomplete or default configurations, open cloud storage, misconfigured HTTP headers, permissive CORS policies, or verbose error messages disclosing stack traces.

### The Standard Security Header Suite
Every modern web application shell must emit:
```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{NONCE}' 'strict-dynamic'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=()
Strict-Transport-Security: max-age=63072000; includeSubDomains
```

### CORS Wildcard Trap
- Setting `Access-Control-Allow-Origin: *` on application HTML shells is dangerous. While modern browsers reject credentials with `*`, it advertises permissive cross-origin access and creates confusion during security reviews.
- Middleware must actively strip unintentional upstream/edge CORS headers on private app routes.

### Decoupling Assets from State
- Never store large binary assets (profile avatars, PDFs, report attachments) as inline base64 strings inside database state payloads.
- Serve assets through dedicated, cacheable endpoints with access control headers (`Cache-Control: private, max-age=86400`).

---

## 6. A06:2021 – Vulnerable and Outdated Components

### Mechanics
Using dependencies with known vulnerabilities (CVEs), unmaintained libraries, or bloated supply chains.

### Remediation Blueprint
- Enforce automated dependency audits in CI: `npm audit --audit-level=high` or equivalent.
- Use pinned lockfiles (`package-lock.json`, `pnpm-lock.yaml`) with integrity hashes.
- Strip build-time framework indicators: disable `X-Powered-By` headers (`poweredByHeader: false` in Next.js).

---

## 7. A07:2021 – Identification and Authentication Failures

### Mechanics
Weaknesses in session management, credential validation, or multi-factor authentication that allow attackers to compromise passwords, keys, or session tokens.

### The "Shadow Local Auth" Hazard
When an enterprise application adopts Central SSO (e.g. Microsoft Entra ID / Okta), legacy username/password authentication pathways or attributes (e.g. `mustChangePassword`, `passwordHash`) frequently remain in the codebase.
- **The Threat:** Attackers bypass corporate SSO conditional access, device compliance policies, and hardware MFA by targeting dormant local login endpoints.
- **Remediation:** Remove local credential validation endpoints completely. Route 100% of authentications through OAuth2 / OIDC authorization code flows with PKCE.

---

## 8. A08:2021 – Software and Data Integrity Failures

### Mechanics
Code and infrastructure that does not protect against integrity violations (e.g. untrusted CI/CD plugins, insecure object deserialization, or unverified auto-updates).

### Remediation Blueprint
- Verify signatures on external modules and packages.
- Never deserialize arbitrary untrusted strings directly into executable classes or objects (e.g. avoiding unsafe `yaml.load`, Python `pickle`, Java serialized objects).

---

## 9. A09:2021 – Security Logging and Monitoring Failures

### Mechanics
Insufficient logging of critical events, absence of real-time monitoring, or logs that fail to provide non-repudiation and auditability.

### Requirements for a Tamper-Evident Security Log
1. **Append-Only Architecture:** The application layer must only possess `INSERT` capability on audit log tables; `UPDATE` and `DELETE` privileges must be revoked at the database role level.
2. **Attribution Tuple:** Every entry must capture:
   `{ timestamp, actorId, actorEmail, actorRole, action, targetEntity, ipAddress, userAgent, summary, diff }`
3. **Capture Both Intent and Result:** Log both successful high-impact operations (e.g. sign-off, data export, role change) and blocked security violations (e.g. `out_of_scope_write`, `unauthorized_delete_attempt`).
4. **Redaction:** Scrub sensitive values (passwords, session cookies, credit card numbers, auth tokens) before persisting.

---

## 10. A10:2021 – Server-Side Request Forgery (SSRF)

### Mechanics
An endpoint fetches a remote resource specified by the user (e.g. webhook URLs, avatar download from URL, document preview) without validating the destination address.
- **The Threat:** Attacker requests internal cloud metadata services (`http://169.254.169.254/latest/meta-data/`) or internal microservices (`http://10.0.0.1/admin`).

### Remediation Blueprint
- **IP Blocklist (Defense-in-depth):** Resolve the hostname to an IP and reject any private, loopback, or link-local ranges:
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
  - `127.0.0.0/8` (localhost)
  - `169.254.0.0/16` (AWS/Azure/GCP metadata)
  - IPv6 equivalents (`::1`, `fc00::/7`, `fe80::/10`)
- **Disable HTTP Redirect Following:** Prevent attackers from redirecting a benign public URL to an internal endpoint.
