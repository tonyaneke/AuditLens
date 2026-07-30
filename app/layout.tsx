import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AuditLens",
  description:
    "Internal audit management — observations, remediation tracking, risk assessment, and reporting.",
  applicationName: "AuditLens",
};

export const viewport: Viewport = {
  themeColor: "#0d5a47",
};

/* Required by the nonce-based CSP in proxy.ts. Next stamps the nonce onto its script tags
   during server-side render, reading it from the request's CSP header — a page prerendered at
   build time has no request, so its scripts would carry no nonce and be blocked at runtime.
   Applies to every route beneath this layout.

   The cost is close to zero here and was measured before making the change: these routes
   prerendered a ~10.8 KB shell containing only the auth spinner, because every page is a
   client component behind AuthGate. No real content was ever being statically served. */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={plusJakarta.variable}>
      <head>
        <link id="favicon" rel="icon" href="/org-logo.png" />
        <link id="touchicon" rel="apple-touch-icon" href="/org-logo.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
