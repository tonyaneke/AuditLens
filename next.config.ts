import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/* QA-016 — security response headers.
   Set here rather than in proxy.ts so the set is identical on everything Next serves: the
   document, /api/*, and static assets alike. The audit found HSTS present on /api/* but not
   on the document; a single source removes that whole class of drift.

   On the CSP: script-src and style-src carry 'unsafe-inline' because this app renders inline
   `style` attributes throughout and Next emits inline bootstrap scripts for the RSC payload.
   The strict alternative is a per-request nonce, which — per the Next 16 CSP guide — forces
   *every* page into dynamic rendering: no static generation, no CDN caching, PPR unavailable.
   Everything other than inline script/style is locked to 'self'.

   DEFERRED DECISION (QA-016): whether to go nonce-based is carried forward into the
   Architecture/concurrency and Performance defect categories, to be taken once with real
   numbers rather than twice on assumption. It needs an architecture call (rendering model)
   and a performance measurement (cost of all-dynamic) — do not settle it in isolation here.
   Until then this policy stops clickjacking and off-origin loading, but NOT injected inline
   script. */
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is required in dev only — React uses eval to rebuild server error stacks.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Microsoft profile photos are fetched server-side and inlined as data URLs.
  "img-src 'self' blob: data:",
  // next/font/google self-hosts at build time, so no external font origin is needed.
  "font-src 'self'",
  // Every third-party call (Graph, SendGrid, Gemini) is made server-side — the browser never
  // needs an off-origin connection.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // The finding's stated business impact: clickjacking against approval / close-out flows.
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Redundant with frame-ancestors, kept for browsers that don't honour CSP Level 2.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  },
];

// Two years, the usual baseline. `preload` is deliberately NOT set: submitting to the preload
// list is effectively irreversible and commits every subdomain to HTTPS indefinitely — an org
// decision, not a code change. Production only, so a dev build over http can't pin localhost.
const hsts = { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" };

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  // Don't advertise the framework or its version.
  poweredByHeader: false,
  // Dev only: allow the app to be opened via 127.0.0.1 as well as localhost (useful when
  // another dev server is squatting on the IPv6 localhost binding of the same port).
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: isDev ? securityHeaders : [...securityHeaders, hsts],
      },
    ];
  },
};

export default nextConfig;
