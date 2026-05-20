import type { NextConfig } from "next";

const RAILWAY_API =
  process.env.RAILWAY_API_URL ??
  "https://caf-pos-repo-production.up.railway.app";

const nextConfig: NextConfig = {
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
