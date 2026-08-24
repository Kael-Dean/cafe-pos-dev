import type { NextConfig } from "next";

// The admin control plane talks to the same FastAPI service as the POS, but on
// its own `/api/v1/admin/*` routes. Admin lives on a SEPARATE hostname from the
// POS by design (different auth realm — an admin token and a POS token are
// rejected by each other's routes), so it cannot borrow the POS proxy.
//
// Phase 1 of the admin API is deployed to staging only; production does not
// serve /api/v1/admin/* yet. Point ADMIN_API_URL at production once it does.
const FALLBACK_API = "https://caf-pos-repo-staging.up.railway.app";

// A rewrite destination that isn't an absolute http(s) URL fails the build
// outright ("Invalid rewrite found"), and an env var can easily arrive with a
// stray BOM, quotes or a trailing slash from whatever shell set it. Sanitise
// first and fall back rather than shipping a broken build.
function resolveApiOrigin(raw: string | undefined): string {
  const cleaned = raw?.replace(/^﻿/, "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (cleaned && /^https?:\/\/\S+$/.test(cleaned)) return cleaned;
  if (raw) {
    console.warn(`[next.config] ADMIN_API_URL is not an absolute http(s) URL — falling back to ${FALLBACK_API}`);
  }
  return FALLBACK_API;
}

const ADMIN_API = resolveApiOrigin(process.env.ADMIN_API_URL);

const nextConfig: NextConfig = {
  async rewrites() {
    // Proxy /api/v1/* through the Next server in ALL environments so the browser
    // only ever calls its own origin → no CORS preflight, no credentials on a
    // cross-site request. Set NEXT_PUBLIC_API_BASE_URL="" and ADMIN_API_URL=<url>.
    return [
      {
        source: "/api/v1/:path*",
        destination: `${ADMIN_API}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
