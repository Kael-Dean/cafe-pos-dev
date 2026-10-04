/**
 * Content-Security-Policy builder (audit M2, plan §3.2). Shipped as
 * Content-Security-Policy-Report-Only from src/proxy.ts; switch the header
 * name to enforce once a week of reports is clean.
 */

export const CSP_REPORT_PATH = '/api/csp-report';
export const CSP_REPORT_GROUP = 'csp-endpoint';
export const PRINT_BRIDGE_ORIGIN = 'http://127.0.0.1:8080';

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /** Extra image hosts (exact https origins, e.g. the R2 public bucket). */
  imageOrigins?: readonly string[];
}

export function r2ImageOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set<string>(['https://*.r2.dev']);
  const base = env.R2_PUBLIC_URL || env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (base) {
    try {
      const u = new URL(base);
      if (u.protocol === 'https:') out.add(u.origin);
    } catch {
      /* malformed env — ignore */
    }
  }
  return [...out];
}

export function buildCsp({ nonce, isDev, imageOrigins = [] }: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // strict-dynamic: nonce'd Next/React bootstrap may load its own chunks.
    // 'unsafe-eval' only in dev (React debug stack reconstruction).
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    // 2,700+ React style={{}} attributes: a style nonce would disable
    // 'unsafe-inline', so styles stay unsafe-inline (low risk, no script).
    'style-src': ["'self'", "'unsafe-inline'"],
    // data: PromptPay QR (qr_image_base64), blob: image crop / XLSX export.
    'img-src': ["'self'", 'data:', 'blob:', ...imageOrigins],
    'font-src': ["'self'"],
    // Local print bridge on the POS PC. Dev adds ws: for HMR.
    'connect-src': ["'self'", PRINT_BRIDGE_ORIGIN, ...(isDev ? ['ws:'] : [])],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'report-uri': [CSP_REPORT_PATH],
    'report-to': [CSP_REPORT_GROUP],
  };
  // upgrade-insecure-requests is ignored in Report-Only mode; add it when enforcing
  // (loopback http://127.0.0.1 bridge is exempt in Chromium).
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/** 128-bit random nonce, base64. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}
