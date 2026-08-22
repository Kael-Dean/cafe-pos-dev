import type { NextConfig } from "next";

// The admin control plane talks to the same FastAPI service as the POS, but on
// its own `/api/v1/admin/*` routes. Admin lives on a SEPARATE hostname from the
// POS by design (different auth realm — an admin token and a POS token are
// rejected by each other's routes), so it cannot borrow the POS proxy.
//
// Phase 1 of the admin API is deployed to staging only; production does not
// serve /api/v1/admin/* yet. Point ADMIN_API_URL at production once it does.
const ADMIN_API =
  process.env.ADMIN_API_URL ??
  "https://caf-pos-repo-staging.up.railway.app";

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
