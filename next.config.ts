import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* Allow the sandbox preview domain to fetch dev assets cross-origin
   * (silences the allowedDevOrigins warning and fixes blank previews). */
  allowedDevOrigins: ["**.space-z.ai"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
