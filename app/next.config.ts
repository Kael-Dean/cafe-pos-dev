import type { NextConfig } from "next";

const RAILWAY_API =
  process.env.RAILWAY_API_URL ??
  "https://caf-pos-repo-production.up.railway.app";

// Menu photos live on Cloudflare R2. Mirror the SSRF allowlist in
// src/app/api/image-proxy/route.ts: the managed `*.r2.dev` / S3
// `*.r2.cloudflarestorage.com` endpoints, plus the configured public base
// (R2_PUBLIC_URL) when a custom domain is used. Whitelisting these lets
// next/image fetch + optimize the originals (resize to display size, serve
// WebP) instead of the browser pulling the full-resolution file.
// Security (audit B1): `*.r2.dev` matches one label only (public buckets are
// always `pub-<id>.r2.dev`). TODO: replace with the exact bucket host once known.
const remotePatterns: NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> = [
  { protocol: "https", hostname: "*.r2.dev" },
  { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
];
const r2Base = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
if (r2Base) {
  try {
    remotePatterns.push({ protocol: "https", hostname: new URL(r2Base).hostname });
  } catch {
    /* malformed env — ignore */
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
    // WebP only. AVIF is disabled (audit B1): the Image Optimizer RCE advisory
    // needs the AVIF path, and the remote host allowlist is still a wildcard.
    formats: ["image/webp"],
  },
  async headers() {
    return [
      {
        // Baseline hardening for every response. A site-wide CSP / frame policy is
        // deliberately NOT set here — the inline theme script and the Epson ePOS
        // SDK need a dedicated security review first.
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // /api/image-proxy relays bytes from any *.r2.dev bucket with the upstream
        // Content-Type (image/svg+xml included). Sandbox the response so a file
        // opened directly as a document can never run script on this origin — the
        // auth tokens live in localStorage. fetch() / <img> use is unaffected.
        source: "/api/image-proxy",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; sandbox" },
          { key: "Content-Disposition", value: "attachment" },
        ],
      },
      {
        // The service worker must never be served stale: a cached sw.js would pin
        // tablets to an old version. Service-Worker-Allowed keeps scope "/" explicit.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Revalidate on every check so a name / icon change reaches installed apps.
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
  async rewrites() {
    // Proxy /api/v1/* through Next.js server-side in ALL environments.
    // Browser calls same-origin Vercel URL → no CORS.
    // Set NEXT_PUBLIC_API_BASE_URL="" and RAILWAY_API_URL=<railway_url> in env.
    return [
      {
        source: "/api/v1/:path*",
        destination: `${RAILWAY_API}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
