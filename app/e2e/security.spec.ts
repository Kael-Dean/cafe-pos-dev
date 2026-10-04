import { test, expect } from '@playwright/test';
import { typePin } from './support/fixtures';

/**
 * These specs talk to the REAL BFF (Next route handlers + proxy.ts). Nothing is mocked in the
 * browser; for login the BFF forwards to e2e/support/fake-upstream.mjs (PIN 123456 = valid).
 * They do not depend on the viewport, so they run once (desktop project).
 */
test.beforeEach(({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'desktop-1440', 'viewport-independent: run once');
});

const EVIL = 'https://evil.example';

test.describe('API gate: authentication', () => {
  test('/api/v1/* without a session cookie -> 401 envelope, never reaches upstream', async ({ request }) => {
    for (const path of ['/api/v1/orders', '/api/v1/products', '/api/v1/auth/me', '/api/v1/hr/staff']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHENTICATED');
      expect(res.headers()['cache-control']).toContain('no-store');
    }
  });

  test('a state-changing call without a session is 401 too (same-origin)', async ({ request, baseURL }) => {
    const res = await request.post('/api/v1/orders', { data: { items: [] }, headers: { Origin: baseURL! } });
    expect(res.status()).toBe(401);
  });

  test('legacy refresh path always answers 401 (refresh tokens never travel through JS)', async ({ request, baseURL }) => {
    const res = await request.post('/api/v1/auth/refresh', { headers: { Origin: baseURL! } });
    expect(res.status()).toBe(401);
  });

  test('path traversal / encoded dots are rejected before any upstream call', async ({ request, baseURL }) => {
    const cookie = { Cookie: 'pos_at=anything; pos_session=1', Origin: baseURL! };
    for (const path of ['/api/v1/..%2f..%2fadmin', '/api/v1/%2e%2e/secret', '/api/v1/orders/..%5c..']) {
      const res = await request.get(path, { headers: cookie, maxRedirects: 0 });
      expect([400, 404], path).toContain(res.status());
    }
  });
});

test.describe('API gate: CSRF origin guard', () => {
  test('POST with a foreign Origin -> 403 FORBIDDEN_ORIGIN (even with a valid-looking cookie)', async ({ request }) => {
    const res = await request.post('/api/v1/orders', {
      data: { items: [] },
      headers: { Origin: EVIL, Cookie: 'pos_at=anything; pos_session=1' },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN_ORIGIN');
  });

  for (const [method, path] of [
    ['PATCH', '/api/v1/orders/abc/pay'],
    ['PUT', '/api/v1/products/abc/recipe'],
    ['DELETE', '/api/v1/products/abc'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/auth/refresh'],
    ['POST', '/api/auth/verify-pin'],
  ] as const) {
    test(`${method} ${path} with a foreign Origin -> 403`, async ({ request }) => {
      const res = await request.fetch(path, { method, data: {}, headers: { Origin: EVIL } });
      expect(res.status()).toBe(403);
      expect((await res.json()).error.code).toBe('FORBIDDEN_ORIGIN');
    });
  }

  test('cross-site fetch metadata without an Origin header is refused as well', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { store_slug: 'x', pin: '123456' },
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status()).toBe(403);
  });

  test('our own Origin passes the guard (control: validation error, not 403)', async ({ request, baseURL }) => {
    const res = await request.post('/api/auth/login', {
      data: { store_slug: 'x', pin: 'abc' }, // fails schema validation before any upstream call
      headers: { Origin: baseURL! },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  test('GET is never blocked by the origin guard', async ({ request }) => {
    const res = await request.get('/api/v1/orders', { headers: { Origin: EVIL } });
    expect(res.status()).toBe(401); // auth, not CSRF
  });
});

test.describe('security headers', () => {
  test('documents carry CSP Report-Only with a per-request nonce, X-Frame-Options and friends', async ({ request }) => {
    const a = await request.get('/');
    const b = await request.get('/');
    expect(a.status()).toBe(200);
    const h = a.headers();

    const csp = h['content-security-policy-report-only'];
    expect(csp, 'CSP-Report-Only header').toBeTruthy();
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=_-]{16,}'/);
    expect(h['reporting-endpoints']).toContain('/api/csp-report');

    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('camera=()');

    // Nonce must be fresh for every response.
    const nonce = (s: string) => /'nonce-([^']+)'/.exec(s)?.[1];
    expect(nonce(b.headers()['content-security-policy-report-only'])).not.toBe(nonce(csp));
  });

  test('API responses are sandboxed + uncacheable', async ({ request }) => {
    const res = await request.get('/api/v1/orders'); // 401 from the BFF itself
    expect(res.headers()['cache-control']).toContain('no-store');
    expect(res.headers()['x-frame-options']).toBe('DENY');
  });

  test('the CSP report sink accepts reports and answers 204 without echoing input', async ({ request }) => {
    const res = await request.post('/api/csp-report', {
      data: { 'csp-report': { 'blocked-uri': 'https://evil.example/x.js', 'violated-directive': 'script-src' } },
      headers: { 'Content-Type': 'application/csp-report' },
    });
    expect(res.status()).toBe(204);
    expect(await res.text()).toBe('');
  });
});

test.describe('real login through the BFF (fake upstream)', () => {
  test('tokens live in HttpOnly cookies only: nothing secret in JS-readable storage', async ({ page, context }) => {
    await page.goto('/');
    await page.getByLabel('Store ID').fill('sec-shop-1');
    await page.getByRole('button', { name: 'ถัดไป' }).click();

    const loginResponse = page.waitForResponse((r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
    await typePin(page, '123456');
    const res = await loginResponse;
    expect(res.status()).toBe(200);

    expect(res.headers()['cache-control']).toContain('no-store');

    // App is up (the shell renders even though the fake upstream has no catalogue).
    await expect(page.getByRole('heading', { name: 'หน้าขาย (POS)' })).toBeVisible();

    // Cookies: access + refresh are HttpOnly, SameSite=Strict; the flag cookie is readable but holds no secret.
    const cookies = await context.cookies();
    const by = Object.fromEntries(cookies.map((c) => [c.name, c]));
    expect(by.pos_at, 'access cookie').toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(by.pos_rt, 'refresh cookie').toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/auth' });
    expect(by.pos_session, 'flag cookie').toMatchObject({ httpOnly: false, value: '1', sameSite: 'Strict' });

    // JS can see the flag, but neither token.
    const jsCookie = await page.evaluate(() => document.cookie);
    expect(jsCookie).toContain('pos_session=1');
    expect(jsCookie).not.toContain('pos_at');
    expect(jsCookie).not.toContain('pos_rt');

    // Web storage: no token-like keys and no JWT-shaped values.
    const storage = await page.evaluate(() => {
      const dump = (s: Storage) => Object.fromEntries(Object.keys(s).map((k) => [k, s.getItem(k) ?? '']));
      return { local: dump(localStorage), session: dump(sessionStorage) };
    });
    const keys = [...Object.keys(storage.local), ...Object.keys(storage.session)];
    expect(keys.filter((k) => /token|jwt|bearer|access|refresh|secret|session_id/i.test(k)), `keys: ${keys.join(', ')}`).toEqual([]);
    expect(JSON.stringify(storage)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(JSON.stringify(storage)).not.toContain('123456'); // the PIN is never persisted
    expect(storage.local['cafe_pos_token']).toBeUndefined();
    expect(storage.local['cafe_pos_refresh_token']).toBeUndefined();

    // The BFF attaches the bearer itself: the browser request carries no Authorization header.
    const meReq = page.waitForRequest((r) => r.url().endsWith('/api/v1/auth/me'));
    await page.reload();
    const req = await meReq;
    expect(await req.headerValue('authorization')).toBeNull();

    // And the session really works through the proxy (cookie -> bearer -> fake upstream /auth/me).
    const me = await page.evaluate(async () => (await fetch('/api/v1/auth/me', { credentials: 'same-origin' })).json());
    expect(me).toMatchObject({ role: 'OWNER', store_name: 'E2E' });

    // Logout clears every cookie, including the HttpOnly pair.
    const status = await page.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })).status);
    expect(status).toBe(200);
    const after = (await context.cookies()).map((c) => c.name);
    expect(after).not.toContain('pos_at');
    expect(after).not.toContain('pos_rt');
    expect(after).not.toContain('pos_session');
    const denied = await page.evaluate(async () => (await fetch('/api/v1/auth/me', { credentials: 'same-origin' })).status);
    expect(denied).toBe(401);
  });

  test('the login response body carries an opaque marker, never a JWT', async ({ request, baseURL }) => {
    const res = await request.post('/api/auth/login', {
      data: { store_slug: 'sec-shop-2', pin: '123456' },
      headers: { Origin: baseURL! },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true, access_token: 'cookie-session', refresh_token: null, token_type: 'cookie' });
    const setCookie = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);
    expect(setCookie.find((c) => c.startsWith('pos_at='))).toMatch(/HttpOnly/i);
    const refresh = setCookie.find((c) => c.startsWith('pos_rt=')) ?? '';
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toContain('Path=/api/auth');
    expect(setCookie.find((c) => c.startsWith('pos_session='))).not.toMatch(/HttpOnly/i);
  });

  test('legacy localStorage tokens from before the cookie migration are purged', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pos_session', value: '1', url: baseURL! }]);
    await page.addInitScript(() => {
      localStorage.setItem('cafe_pos_token', 'eyJhbGciOiJub25lIn0.legacy.sig');
      localStorage.setItem('cafe_pos_refresh_token', 'eyJhbGciOiJub25lIn0.legacyrefresh.sig');
    });
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => [localStorage.getItem('cafe_pos_token'), localStorage.getItem('cafe_pos_refresh_token')])).toEqual([null, null]);
  });
});
