import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  // Dev only: allow the app to be opened via 127.0.0.1 as well as localhost (useful when
  // another dev server is squatting on the IPv6 localhost binding of the same port).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
