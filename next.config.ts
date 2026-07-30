import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/* QA-016 — security response headers.
   These have no per-request component, so they are set here once and apply identically to the
   document, /api/*, and static assets. The audit found HSTS present on /api/* but not on the
   document; a single source removes that whole class of drift.

   The Content-Security-Policy is NOT here — it lives in proxy.ts, because it carries a
   per-request nonce that static config cannot express. Setting it in both places would emit two
   CSP headers, which browsers enforce as the intersection of the two. See proxy.ts for the
   policy and the reasoning behind each directive.

   DECIDED (was deferred from QA-016): the policy is now nonce-based, so an injected inline
   <script> no longer executes. The cost that had been assumed prohibitive — losing static
   generation — was measured on 2026-07-30 and is negligible here: every "static" route
   prerendered a ~10.8 KB shell containing only the auth spinner and the text "Loading…",
   because every page is a client component behind AuthGate. There was no cacheable content to
   give up. */
const securityHeaders = [
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
