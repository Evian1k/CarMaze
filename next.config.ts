import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* Allow the sandbox preview domain to fetch dev assets cross-origin
   * (silences the allowedDevOrigins warning and fixes blank previews). */
  allowedDevOrigins: ["**.space-z.ai"],
  // TypeScript errors are no longer suppressed: `bunx tsc --noEmit` must stay
  // clean (verified during the remediation pass) and builds fail on real
  // type errors instead of hiding them.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
