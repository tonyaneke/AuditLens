import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audit Reporting Bot — CREDICORP Internal Audit",
  description:
    "Internal audit management — observations, remediation tracking, risk assessment, and reporting.",
  applicationName: "CREDICORP Internal Audit",
};

export const viewport: Viewport = {
  themeColor: "#0d5a47",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link id="favicon" rel="icon" href="" />
        <link id="touchicon" rel="apple-touch-icon" href="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
