import type { NextConfig } from "next";

const RAILWAY_API =
  process.env.RAILWAY_API_URL ??
  "https://caf-pos-repo-production.up.railway.app";

// Menu photos live on Cloudflare R2. Mirror the SSRF allowlist in
// src/app/api/image-proxy/route.ts: the managed `*.r2.dev` / S3
// `*.r2.cloudflarestorage.com` endpoints, plus the configured public base
// (R2_PUBLIC_URL) when a custom domain is used. Whitelisting these lets
// next/image fetch + optimize the originals (resize to display size, serve
// AVIF/WebP) instead of the browser pulling the full-resolution file.
const remotePatterns: NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> = [
  { protocol: "https", hostname: "**.r2.dev" },
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
    // AVIF first (≈20% smaller than WebP), WebP fallback for browsers without AVIF.
    formats: ["image/avif", "image/webp"],
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
