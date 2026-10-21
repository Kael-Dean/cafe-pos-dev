import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * In-browser stand-in for the BFF boundary (/api/v1/* and /api/auth/*).
 *
 * The real BFF forwards to Railway from the Next *server*, which a browser-level
 * `page.route` cannot see, so functional specs replace the BFF's answers instead.
 * The real BFF (origin guard, cookies, headers) is covered separately by
 * e2e/security.spec.ts against the fake upstream.
 *
 * Every request is recorded in `calls`; anything without a handler answers 404 and is
 * listed in `unhandled` so a spec can assert the screen did not need an endpoint we
 * forgot to model.
 */

export type Role = 'OWNER' | 'MANAGER' | 'BARISTA' | 'BAKER';

export interface Call {
  method: string;
  path: string; // pathname only
  search: string;
  body: unknown;
}

export interface MockProduct {
  id: string;
  name: string;
  price: string;
  category_id: string;
  modifier_groups?: { id: string }[];
}

export interface MockOrder {
  id: string;
  order_number: number;
  daily_number: number;
  receipt_no: string;
  status: 'PENDING' | 'PAID' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' | 'VOID';
  channel: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  total: string;
  created_at: string;
  items: { product_name: string; quantity: number; modifiers_json: Record<string, unknown> | null }[];
  idempotency_key?: string;
  session_id?: string | null;
}

const STORE_ID = 'store-e2e-1';

export const CATEGORIES = [
  { id: 'cat-coffee', store_id: STORE_ID, name: 'กาแฟ', sort_order: 1, is_active: true },
  { id: 'cat-bakery', store_id: STORE_ID, name: 'เบเกอรี่', sort_order: 2, is_active: true },
];

export const PRODUCTS: MockProduct[] = [
  { id: 'p-latte', name: 'ลาเต้ร้อน', price: '60.00', category_id: 'cat-coffee' },
  { id: 'p-americano', name: 'อเมริกาโน่', price: '50.00', category_id: 'cat-coffee' },
  { id: 'p-croissant', name: 'ครัวซองต์', price: '45.00', category_id: 'cat-bakery' },
];

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) });

export class MockApi {
  calls: Call[] = [];
  unhandled: string[] = [];
  orders: MockOrder[] = [];

  role: Role = 'OWNER';
  features: string[] = [];
  /** Catalogue served by GET /categories, /products, /products/:id and priced by POST /orders.
   *  Defaults to the small shared fixture; a spec may swap in a larger one (e.g. the visual capture). */
  categories: typeof CATEGORIES = CATEGORIES;
  products: MockProduct[] = PRODUCTS;
  /** Next N `PATCH /orders/:id/pay` answer 500 (payment failure injection). */
  failPay = 0;
  /** Next N `POST /orders` answer 500 (order-creation failure injection). */
  failCreate = 0;
  /** Extra handlers a spec can add; first one returning true wins. */
  extra: Array<(c: Call, route: Route, self: MockApi) => Promise<boolean> | boolean> = [];
  /** Clock for server-side timestamps (`created_at` of new orders). Real time by default; a spec
   *  that pins the page clock (page.clock) should pin this too so receipts show the same time. */
  now: () => Date = () => new Date();

  private seq = 100;

  /** Calls matching method + path (regex or string prefix). */
  find(method: string, path: RegExp | string): Call[] {
    return this.calls.filter(
      (c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)),
    );
  }

  seedOrder(partial: Partial<MockOrder> & { status: MockOrder['status'] }): MockOrder {
    const n = ++this.seq;
    const o: MockOrder = {
      id: `ord-${n}`,
      order_number: n,
      daily_number: n - 100,
      receipt_no: `IV2569-${String(n).padStart(4, '0')}`,
      channel: 'DINE_IN',
      total: '60.00',
      created_at: this.now().toISOString(),
      items: [{ product_name: 'ลาเต้ร้อน', quantity: 1, modifiers_json: null }],
      ...partial,
    };
    this.orders.push(o);
    return o;
  }

  /** Make this context look signed in: the readable flag cookie the BFF sets after login. */
  async signIn(context: BrowserContext, baseURL: string): Promise<void> {
    await context.addCookies([{ name: 'pos_session', value: '1', url: baseURL }]);
  }

  async install(page: Page): Promise<void> {
    await page.route(/\/api\/(v1|auth)\//, (route) => void this.handle(route));
  }

  // ── routing ────────────────────────────────────────────────────────────────
  private async handle(route: Route): Promise<void> {
    const req = route.request();
    const url = new URL(req.url());
    let body: unknown = null;
    const raw = req.postData();
    if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    const call: Call = { method: req.method(), path: url.pathname, search: url.search, body };
    this.calls.push(call);

    for (const h of this.extra) if (await h(call, route, this)) return;
    if (await this.builtin(call, route)) return;

    this.unhandled.push(`${call.method} ${call.path}${call.search}`);
    await json(route, 404, { error: { code: 'NOT_MOCKED', message: `e2e mock has no handler for ${call.method} ${call.path}` } });
  }

  private async builtin(c: Call, route: Route): Promise<boolean> {
    const { method: m, path: p } = c;

    // ── auth (BFF) ──
    if (m === 'POST' && p === '/api/auth/login') {
      const b = c.body as { pin?: string } | null;
      if (b?.pin === '123456') {
        await json(route, 200, { ok: true, access_token: 'cookie-session', refresh_token: null, token_type: 'cookie' }, {
          // The real BFF sets this readable flag next to its HttpOnly cookies.
          'set-cookie': 'pos_session=1; Path=/; SameSite=Strict',
        });
      } else {
        await json(route, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'PIN หรือ Store ID ไม่ถูกต้อง' } });
      }
      return true;
    }
    if (m === 'POST' && p === '/api/auth/logout') {
      await json(route, 200, { ok: true }, { 'set-cookie': 'pos_session=; Path=/; Max-Age=0; SameSite=Strict' });
      return true;
    }
    if (m === 'POST' && p === '/api/auth/refresh') { await json(route, 401, { error: { code: 'SESSION_EXPIRED', message: 'expired' } }); return true; }
    if (p === '/api/auth/bridge-token') { await json(route, 401, { error: { code: 'UNAUTHENTICATED', message: 'no bridge in e2e' } }); return true; }

    // ── identity ──
    if (m === 'GET' && p === '/api/v1/auth/me') {
      await json(route, 200, {
        id: 'user-e2e-1', name: this.role === 'BARISTA' ? 'บาริสต้า E2E' : 'เจ้าของ E2E', role: this.role,
        store_id: STORE_ID, store_name: 'สาขา E2E', tenant_id: 'tenant-e2e-1',
      });
      return true;
    }
    if (m === 'GET' && p === '/api/v1/me/features') { await json(route, 200, { features: this.features }); return true; }

    // ── catalogue ──
    if (m === 'GET' && p === '/api/v1/categories') { await json(route, 200, this.categories); return true; }
    if (m === 'GET' && p === '/api/v1/products') {
      await json(route, 200, this.products.map((x) => ({
        id: x.id, store_id: STORE_ID, category_id: x.category_id, name: x.name, description: null, price: x.price,
        is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null, image_url: null,
      })));
      return true;
    }
    const prod = /^\/api\/v1\/products\/([^/]+)$/.exec(p);
    if (m === 'GET' && prod) {
      const x = this.products.find((q) => q.id === prod[1]);
      if (!x) { await json(route, 404, { error: { code: 'NOT_FOUND', message: 'no product' } }); return true; }
      await json(route, 200, { id: x.id, name: x.name, price: x.price, modifier_groups: x.modifier_groups ?? [] });
      return true;
    }
    if (m === 'GET' && p === '/api/v1/reports/sales') { await json(route, 200, { buckets: [], total_revenue: '0', total_orders: 0 }); return true; }
    if (m === 'POST' && p === '/api/v1/promotions/evaluate') { await json(route, 200, { eligible: [] }); return true; }
    if (m === 'GET' && p === '/api/v1/membership/program') { await json(route, 200, null); return true; }
    if (m === 'GET' && p === '/api/v1/hr/cash-sessions/current') { await json(route, 200, null); return true; }

    // ── orders ──
    if (m === 'GET' && p === '/api/v1/orders') {
      const wanted = new URL(`http://x${c.search}`).searchParams.getAll('status');
      const items = this.orders.filter((o) => wanted.length === 0 || wanted.includes(o.status));
      await json(route, 200, { items, total: items.length, page: 1, limit: 200 });
      return true;
    }
    if (m === 'POST' && p === '/api/v1/orders') {
      if (this.failCreate > 0) {
        this.failCreate -= 1;
        await json(route, 500, { error: { code: 'INTERNAL', message: 'สร้างออเดอร์ไม่สำเร็จ' } });
        return true;
      }
      const b = c.body as {
        idempotency_key: string;
        channel: MockOrder['channel'];
        items: { product_id: string; quantity: number }[];
        session_id?: string;
      };
      // Same contract as the real backend: a repeated idempotency key returns the original order.
      const dup = this.orders.find((o) => o.idempotency_key === b.idempotency_key);
      if (dup) { await json(route, 200, dup); return true; }
      let total = 0;
      const items = b.items.map((it) => {
        const prodRow = this.products.find((q) => q.id === it.product_id)!;
        total += Number(prodRow.price) * it.quantity;
        return { product_name: prodRow.name, quantity: it.quantity, modifiers_json: null };
      });
      const o = this.seedOrder({
        status: 'PENDING', channel: b.channel, total: total.toFixed(2), items, idempotency_key: b.idempotency_key,
        session_id: b.session_id ?? null,
      });
      await json(route, 201, o);
      return true;
    }
    const pay = /^\/api\/v1\/orders\/([^/]+)\/pay$/.exec(p);
    if (m === 'PATCH' && pay) {
      if (this.failPay > 0) {
        this.failPay -= 1;
        await json(route, 500, { error: { code: 'INTERNAL', message: 'ระบบชำระเงินขัดข้อง' } });
        return true;
      }
      const o = this.orders.find((q) => q.id === pay[1]);
      if (!o) { await json(route, 404, { error: { code: 'NOT_FOUND', message: 'no order' } }); return true; }
      o.status = 'PAID';
      await json(route, 200, { ...o, points_earned: 0, reward_redeemed: false });
      return true;
    }
    const status = /^\/api\/v1\/orders\/([^/]+)\/status$/.exec(p);
    if (m === 'PATCH' && status) {
      const o = this.orders.find((q) => q.id === status[1]);
      if (o) o.status = (c.body as { status: MockOrder['status'] }).status;
      await json(route, 200, o ?? {});
      return true;
    }
    return false;
  }
}
