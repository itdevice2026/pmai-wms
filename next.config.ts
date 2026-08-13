import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Security headers for an internet-facing deployment.
 *
 * The CSP allows 'unsafe-inline' for styles because Tailwind injects a style
 * element, and Next's streaming runtime uses inline bootstrap scripts. It does
 * NOT allow arbitrary remote script or frame sources.
 *
 * connect-src includes ws:/wss: so the local scale bridge (src/lib/scale.ts)
 * can reach the weighing PC's agent from the browser.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Required by forbidden() in src/lib/auth.ts (requirePermission).
  experimental: {
    authInterrupts: true,
  },

  poweredByHeader: false,

  // Needed for the Docker deployment path; harmless elsewhere.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
