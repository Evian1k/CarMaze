import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * CSP: strict in PRODUCTION. In DEVELOPMENT no CSP is emitted at all — the
 * sandbox preview embeds the app in a cross-origin iframe and React refresh
 * needs eval; neither is true of the real deployment.
 *
 * Production policy notes:
 *  - script-src 'unsafe-inline' is required by the Next.js App Router
 *    hydration bootstrap (no per-request nonce without middleware); everything
 *    else is locked to 'self'.
 *  - img-src data: blob: covers QR codes rendered as data URLs and three.js
 *    texture buffers. worker-src blob: covers the 3D customizer worker.
 *  - frame-ancestors 'none' + X-Frame-Options DENY: the app is never framed.
 *  - HSTS is declared here AND must be enforced at the TLS-terminating proxy
 *    (see docs/CARMAZE_DEPLOYMENT_RUNBOOK.md — Caddy owns HTTPS).
 */
const isProd = process.env.NODE_ENV === "production";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = isProd
  ? [
      { key: "Content-Security-Policy", value: CSP },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    ]
  : [];

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
  async headers() {
    if (!isProd || securityHeaders.length === 0) return []
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
