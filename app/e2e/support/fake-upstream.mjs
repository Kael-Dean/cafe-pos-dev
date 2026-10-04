// Stand-in for the Railway FastAPI backend, used ONLY by the real-BFF specs
// (e2e/security.spec.ts). It implements just enough of /api/v1/auth/* for the BFF
// login / logout / session-check handlers. All other flows mock the BFF boundary in
// the browser (e2e/support/mock-api.ts).
//
//   PIN 123456 (any store slug) -> 200 {access_token, refresh_token}
//   anything else              -> 401 envelope
import http from 'node:http';

const PORT = Number(process.env.E2E_UPSTREAM_PORT ?? 3142);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, ttl) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + ttl })}.sig`;

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/__health') return json(res, 200, { ok: true });

    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { /* ignore */ }
        if (body.pin === '123456') {
          return json(res, 200, {
            access_token: jwt('e2e-user', 8 * 3600),
            refresh_token: jwt('e2e-user-refresh', 30 * 86400),
            token_type: 'bearer',
          });
        }
        return json(res, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'PIN หรือ Store ID ไม่ถูกต้อง' } });
      }
      if (url.pathname === '/api/v1/auth/logout') return json(res, 200, { ok: true });
      if (url.pathname === '/api/v1/auth/me') {
        if (!(req.headers.authorization ?? '').startsWith('Bearer ')) return json(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'no token' } });
        return json(res, 200, { id: 'u1', name: 'E2E Owner', role: 'OWNER', store_id: 's1', store_name: 'E2E', tenant_id: 't1' });
      }
      return json(res, 404, { error: { code: 'NOT_FOUND', message: `fake upstream: ${req.method} ${url.pathname}` } });
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fake upstream on :${PORT}`));
