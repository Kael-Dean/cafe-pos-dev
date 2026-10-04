import { describe, expect, it } from 'vitest';
import {
  MemoryRateLimiter,
  clientIpFrom,
  cookieNames,
  cookieOptions,
  isAllowedOrigin,
  isSecureContextRequest,
  parseAllowedOrigins,
  sanitizeUpstreamPath,
  secondsUntilExp,
} from './bff';
import { buildCsp } from './csp';

const SELF = 'https://cafe-pos-sable.vercel.app';

describe('cookie policy', () => {
  it('access cookie: HttpOnly, Secure, SameSite=Strict, Path=/', () => {
    expect(cookieOptions('access', true, 28_800)).toEqual({
      httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 28_800,
    });
  });

  it('refresh cookie is HttpOnly and scoped to /api/auth', () => {
    const o = cookieOptions('refresh', true, 100);
    expect(o.httpOnly).toBe(true);
    expect(o.path).toBe('/api/auth');
    expect(o.sameSite).toBe('strict');
  });

  it('session flag is readable by JS but still Strict + Secure', () => {
    const o = cookieOptions('flag', true, 100);
    expect(o.httpOnly).toBe(false);
    expect(o.secure).toBe(true);
    expect(o.sameSite).toBe('strict');
    expect(o.path).toBe('/');
  });

  it('negative / fractional max-age is clamped to whole seconds >= 0', () => {
    expect(cookieOptions('access', true, -5).maxAge).toBe(0);
    expect(cookieOptions('access', true, 10.9).maxAge).toBe(10);
  });

  it('uses browser-enforced prefixes only when Secure', () => {
    expect(cookieNames(true)).toEqual({ access: '__Host-pos_at', refresh: '__Secure-pos_rt', flag: 'pos_session' });
    expect(cookieNames(false)).toEqual({ access: 'pos_at', refresh: 'pos_rt', flag: 'pos_session' });
  });

  it('Secure everywhere except plain-HTTP loopback', () => {
    expect(isSecureContextRequest('https', 'cafe-pos-sable.vercel.app')).toBe(true);
    expect(isSecureContextRequest('https:', 'localhost:3108')).toBe(true);
    expect(isSecureContextRequest('http', 'localhost:3108')).toBe(false);
    expect(isSecureContextRequest('http', '127.0.0.1:3000')).toBe(false);
    expect(isSecureContextRequest('http', '[::1]:3000')).toBe(false);
    // Plain HTTP on a LAN IP keeps Secure → browser refuses to store the token.
    expect(isSecureContextRequest('http', '192.168.1.20:3000')).toBe(true);
    expect(isSecureContextRequest('http', 'localhost.evil.com')).toBe(true);
  });
});

describe('origin check (CSRF)', () => {
  const base = { selfOrigin: SELF, secFetchSite: null as string | null };

  it('lets safe methods through without an Origin', () => {
    expect(isAllowedOrigin({ ...base, method: 'GET', origin: null })).toBe(true);
    expect(isAllowedOrigin({ ...base, method: 'HEAD', origin: 'https://evil.example' })).toBe(true);
  });

  it('accepts our own origin on POST', () => {
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: SELF })).toBe(true);
  });

  it('rejects a foreign, look-alike or null origin', () => {
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'https://evil.example' })).toBe(false);
    expect(isAllowedOrigin({ ...base, method: 'DELETE', origin: 'https://cafe-pos-sable.vercel.app.evil.example' })).toBe(false);
    expect(isAllowedOrigin({ ...base, method: 'PATCH', origin: 'http://cafe-pos-sable.vercel.app' })).toBe(false);
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'null' })).toBe(false);
  });

  it('falls back to Sec-Fetch-Site when Origin is absent', () => {
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: null, secFetchSite: 'same-origin' })).toBe(true);
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: null, secFetchSite: 'cross-site' })).toBe(false);
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: null, secFetchSite: 'same-site' })).toBe(false);
  });

  it('rejects state-changing requests with neither header', () => {
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: null })).toBe(false);
  });

  it('honours the ALLOWED_ORIGINS allowlist (exact match)', () => {
    const allowedOrigins = parseAllowedOrigins(' https://pos.example.com , https://staging.example.com/ ');
    expect(allowedOrigins).toEqual(['https://pos.example.com', 'https://staging.example.com']);
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'https://pos.example.com', allowedOrigins })).toBe(true);
    expect(isAllowedOrigin({ ...base, method: 'POST', origin: 'https://evil.pos.example.com', allowedOrigins })).toBe(false);
  });
});

describe('in-memory rate limiter', () => {
  it('blocks after the limit and reports Retry-After', () => {
    const lim = new MemoryRateLimiter(3, 60_000);
    const t = 1_000_000;
    expect(lim.hit('k', t).allowed).toBe(true);
    expect(lim.hit('k', t).allowed).toBe(true);
    expect(lim.hit('k', t).remaining).toBe(0);
    expect(lim.check('k', t + 1_000)).toEqual({ allowed: false, retryAfter: 59, remaining: 0 });
    const over = lim.hit('k', t + 1_000);
    expect(over.allowed).toBe(false);
    expect(over.retryAfter).toBe(59);
  });

  it('keys are independent and the window resets', () => {
    const lim = new MemoryRateLimiter(1, 10_000);
    const t = 0;
    lim.hit('a', t);
    expect(lim.check('a', t).allowed).toBe(false);
    expect(lim.check('b', t).allowed).toBe(true);
    expect(lim.check('a', t + 10_000).allowed).toBe(true);
  });

  it('reset() clears a key', () => {
    const lim = new MemoryRateLimiter(1, 60_000);
    lim.hit('a', 0);
    lim.reset('a');
    expect(lim.check('a', 1).allowed).toBe(true);
  });

  it('stays bounded under key spraying', () => {
    const lim = new MemoryRateLimiter(1, 60_000, 100);
    for (let i = 0; i < 1_000; i++) lim.hit(`k${i}`, 0);
    // Oldest keys were evicted; the newest is still tracked.
    expect(lim.check('k999', 1).allowed).toBe(false);
    expect(lim.check('k0', 1).allowed).toBe(true);
  });
});

describe('client IP', () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
  it('prefers x-real-ip, then first x-forwarded-for hop', () => {
    expect(clientIpFrom(h({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.2.3.4');
    expect(clientIpFrom(h({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }))).toBe('5.6.7.8');
    expect(clientIpFrom(h({}))).toBe('unknown');
  });
});

describe('JWT exp peek', () => {
  const jwt = (payload: object) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
  it('returns seconds until exp, clamped to the cap', () => {
    const now = 1_700_000_000_000;
    expect(secondsUntilExp(jwt({ exp: now / 1000 + 600 }), 99, 28_800, now)).toBe(600);
    expect(secondsUntilExp(jwt({ exp: now / 1000 + 999_999 }), 99, 28_800, now)).toBe(28_800);
    expect(secondsUntilExp(jwt({ exp: now / 1000 - 5 }), 99, 28_800, now)).toBe(0);
  });
  it('falls back when the token is not a readable JWT', () => {
    expect(secondsUntilExp('garbage', 120, 28_800)).toBe(120);
    expect(secondsUntilExp(jwt({ sub: 'x' }), 120, 28_800)).toBe(120);
  });
});

describe('upstream path sanitizer', () => {
  it('passes normal API paths and keeps a trailing slash', () => {
    expect(sanitizeUpstreamPath('orders/123/void')).toBe('orders/123/void');
    expect(sanitizeUpstreamPath('products/')).toBe('products/');
    expect(sanitizeUpstreamPath('shopping-list/print')).toBe('shopping-list/print');
  });
  it('rejects traversal, encoded slashes, backslashes and control chars', () => {
    expect(sanitizeUpstreamPath('../admin')).toBeNull();
    expect(sanitizeUpstreamPath('orders/%2e%2e/x')).toBeNull();
    expect(sanitizeUpstreamPath('orders/a%2Fb')).toBeNull();
    expect(sanitizeUpstreamPath('orders/a%5Cb')).toBeNull();
    expect(sanitizeUpstreamPath('orders//x')).toBeNull();
    expect(sanitizeUpstreamPath('orders/%0d%0aHost:x')).toBeNull();
    expect(sanitizeUpstreamPath('')).toBeNull();
    expect(sanitizeUpstreamPath('a/%E0%A4%A')).toBeNull();
  });
  it('re-encodes so a segment can never change the upstream host', () => {
    expect(sanitizeUpstreamPath('customers/a@evil.com:443')).toBe('customers/a%40evil.com%3A443');
  });
});

describe('CSP builder', () => {
  it('nonce + strict-dynamic, frame-ancestors none, report endpoint, no unsafe-eval in prod', () => {
    const csp = buildCsp({ nonce: 'abc123', isDev: false, imageOrigins: ['https://*.r2.dev'] });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain('connect-src \'self\' http://127.0.0.1:8080');
    expect(csp).toContain('img-src \'self\' data: blob: https://*.r2.dev');
    expect(csp).toContain('report-uri /api/csp-report');
  });
  it('dev adds unsafe-eval and ws: for HMR', () => {
    const csp = buildCsp({ nonce: 'n', isDev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toMatch(/connect-src [^;]*ws:/);
  });
});
