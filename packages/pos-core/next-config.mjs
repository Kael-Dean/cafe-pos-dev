// Shared Next config for every edition. Each app's next.config.ts is just
// `export default createNextConfig()` so security headers, the image allowlist
// and monorepo settings can never drift between editions.
//
// Plain ESM + JSDoc (not .ts) on purpose: next.config.ts is loaded by Next's own
// config loader, which does not transpile TypeScript imported from a workspace
// package.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {import('next').NextConfig} NextConfig */

// packages/pos-core → repo root. Turbopack and output file tracing must both see
// the whole workspace (packages/* lives outside the app directory).
const MONOREPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Menu photos live on Cloudflare R2. Mirror the SSRF allowlist in
// lib/server/routes/image-proxy.ts: the managed `*.r2.dev` / S3
// `*.r2.cloudflarestorage.com` endpoints, plus the configured public base
// (R2_PUBLIC_URL) when a custom domain is used. Whitelisting these lets
// next/image fetch + optimize the originals (resize to display size, serve
// WebP) instead of the browser pulling the full-resolution file.
// Security (audit B1): `*.r2.dev` matches one label only (public buckets are
// always `pub-<id>.r2.dev`). TODO: replace with the exact bucket host once known.
function remotePatterns() {
  /** @type {NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>} */
  const patterns = [
    { protocol: 'https', hostname: '*.r2.dev' },
    { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
  ];
  const r2Base = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (r2Base) {
    try {
      patterns.push({ protocol: 'https', hostname: new URL(r2Base).hostname });
    } catch {
      /* malformed env — ignore */
    }
  }
  return patterns;
}

/**
 * @param {NextConfig} [overrides] Edition-specific additions. `headers` and
 *   `images` are owned by core and cannot be replaced here (security baseline).
 * @returns {NextConfig}
 */
export function createNextConfig(overrides = {}) {
  /** @type {NextConfig} */
  const config = {
    ...overrides,
    // Core ships TypeScript source. Turbopack already transpiles workspace
    // packages; listing it keeps webpack builds and tooling explicit.
    transpilePackages: ['@pos/core', ...(overrides.transpilePackages ?? [])],
    outputFileTracingRoot: MONOREPO_ROOT,
    turbopack: { ...(overrides.turbopack ?? {}), root: MONOREPO_ROOT },
    images: {
      remotePatterns: remotePatterns(),
      // WebP only. AVIF is disabled (audit B1): the Image Optimizer RCE advisory
      // needs the AVIF path, and the remote host allowlist is still a wildcard.
      formats: ['image/webp'],
    },
    async headers() {
      return [
        {
          // Baseline hardening for every response (security audit 2026-10, plan §3.3).
          // The nonce CSP (Report-Only for now) is per request, so it lives in
          // lib/server/proxy.ts, not here. X-Frame-Options is the legacy fallback for its
          // frame-ancestors 'none' and is enforced already (clickjacking on
          // void/pay buttons, M2).
          source: '/(.*)',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'X-Frame-Options', value: 'DENY' },
            {
              key: 'Permissions-Policy',
              value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=()',
            },
            { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
            // Vercel already sends HSTS; set it explicitly so a custom domain or a
            // non-Vercel host keeps it.
            { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          ],
        },
        {
          // /api/image-proxy relays bytes from any *.r2.dev bucket with the upstream
          // Content-Type (image/svg+xml included). Sandbox the response so a file
          // opened directly as a document can never run script on this origin (it
          // could still drive the cookie session). fetch() / <img> use is unaffected.
          source: '/api/image-proxy',
          headers: [
            { key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" },
            { key: 'Content-Disposition', value: 'attachment' },
          ],
        },
        {
          // The service worker must never be served stale: a cached sw.js would pin
          // tablets to an old version. Service-Worker-Allowed keeps scope "/" explicit.
          source: '/sw.js',
          headers: [
            { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
            { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
            { key: 'Service-Worker-Allowed', value: '/' },
          ],
        },
        {
          // Revalidate on every check so a name / icon change reaches installed apps.
          source: '/manifest.webmanifest',
          headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
        },
      ];
    },
    // No /api/v1 rewrite: lib/server/routes/bff-proxy.ts (re-exported by each app's
    // app/api/v1/[...path]/route.ts) is the cookie BFF proxy to RAILWAY_API_URL and
    // attaches the bearer server-side (audit M1).
  };
  return config;
}
