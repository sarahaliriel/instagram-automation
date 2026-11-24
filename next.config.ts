import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Verification query strings contain a secret; suppress development URL logging.
  logging: false,
  reactStrictMode: true,
};

export default nextConfig;
