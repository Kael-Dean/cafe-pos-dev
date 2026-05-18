import type { NextConfig } from "next";

const RAILWAY_API = "https://caf-pos-repo-production.up.railway.app";

const nextConfig: NextConfig = {
  async rewrites() {
    // In dev, proxy /api/v1/* to Railway so CORS is bypassed server-side.
    // In prod (Vercel), NEXT_PUBLIC_API_BASE_URL points directly to Railway — no proxy needed.
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/api/v1/:path*",
        destination: `${RAILWAY_API}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
