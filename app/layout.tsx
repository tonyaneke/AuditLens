import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AMS — Audit Management System",
  description:
    "Internal audit management — observations, remediation tracking, risk assessment, and reporting.",
  applicationName: "AMS",
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
    <html lang="en" className={plusJakarta.variable}>
      <head>
        <link id="favicon" rel="icon" href="" />
        <link id="touchicon" rel="apple-touch-icon" href="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
