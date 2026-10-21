import type { Route } from '@playwright/test';
import QRCode from 'qrcode';
import type { Call, MockApi, MockOrder } from './mock-api';

/**
 * Stateful stand-in for the table-QR self-ordering backend (handoff
 * D:\พี่เสือ\docs\table-ordering\api-handoff.md, Part B + C), layered on MockApi:
 *
 *   GET  /floor/tables · /floor/live · /floor/tables/{id}/qr · POST …/qr/reissue
 *   GET  /table-sessions/{sid}/bill[?guest_id] · …/bill/promptpay-qr[?guest_id]
 *   POST /table-sessions/{sid}/guests/{gid}/checkout · …/bill/pay · …/close
 *   POST /table-sessions/{sid}/orders/{oid}/reassign · POST /orders/{id}/void
 *   GET/POST /rate-plans · PATCH /categories/{id} · GET/PATCH /products (admin fields)
 *
 * Contract rules the screens must respect are enforced here too: GUEST pay without
 * checkout → 409, close with anything unpaid → `{settled: false}`, barista on QR → 403.
 * Orders live in MockApi.orders so the existing GET /orders + PATCH status handlers
 * serve the order board.
 */

const STORE_ID = 'store-e2e-1';

export interface BarGuest {
  id: string; session_id: string; label: string;
  status: 'ACTIVE' | 'CHECKOUT_REQUESTED' | 'CHECKED_OUT';
  arrived_at: string; checkout_requested_at: string | null; left_at: string | null;
}
interface BarSession { id: string; table_id: string; opened_at: string; closed_at: string | null; party_size: number; closed: boolean }
interface BarTable { id: string; name: string; zone: string | null; capacity: number; is_active: boolean; code: string }

const min = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const money = (n: number) => n.toFixed(2);
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });
const err = (route: Route, status: number, code: string, message: string) => json(route, status, { error: { code, message } });

export class BarState {
  guestAppUrl: string | null = 'https://mrbar.example';
  tables: BarTable[] = [
    { id: 't1', name: 'T1', zone: null, capacity: 2, is_active: true, code: 'c-t1' },
    { id: 't2', name: 'T2', zone: null, capacity: 4, is_active: true, code: 'c-t2' },
    { id: 't3', name: 'T3', zone: null, capacity: 4, is_active: true, code: 'c-t3' },
    { id: 't4', name: 'T4', zone: null, capacity: 6, is_active: true, code: 'c-t4' },
    { id: 't5', name: 'T5', zone: null, capacity: 4, is_active: true, code: 'c-t5' },
    { id: 't6', name: 'T6', zone: null, capacity: 2, is_active: true, code: 'c-t6' },
  ];
  sessions: BarSession[] = [];
  guests: BarGuest[] = [];
  ratePlans: { id: string; name: string; billing_mode: string; hourly_rate: string; is_default: boolean; is_active: boolean }[] = [];
  categories: Record<string, Record<string, unknown>> = {};
  productExtra: Record<string, Record<string, unknown>> = {};
  bills: { scope: string; guest_id?: string; payment_method: string; amount: string }[] = [];
  private seq = 0;
  qrPng = '';

  constructor(private api: MockApi) {}

  async init(): Promise<void> {
    this.qrPng = (await QRCode.toDataURL('https://mrbar.example/t/demo', { margin: 1, width: 240 })).split(',')[1];
  }

  id(p: string) { return `${p}-${++this.seq}`; }

  openSession(tableId: string, openedMinAgo: number): BarSession {
    const s = { id: `ses-${tableId}`, table_id: tableId, opened_at: min(openedMinAgo), closed_at: null, party_size: 0, closed: false };
    this.sessions.push(s);
    return s;
  }

  addGuest(sessionId: string, label: string, status: BarGuest['status'] = 'ACTIVE', arrivedMinAgo = 30): BarGuest {
    const g: BarGuest = {
      id: `g-${label.toLowerCase().replace(/\s+/g, '')}-${sessionId}`, session_id: sessionId, label, status,
      arrived_at: min(arrivedMinAgo), checkout_requested_at: status === 'CHECKOUT_REQUESTED' ? min(2) : null, left_at: null,
    };
    this.guests.push(g);
    const s = this.sessions.find((x) => x.id === sessionId)!;
    s.party_size = this.guests.filter((x) => x.session_id === sessionId).length;
    return g;
  }

  /** A guest order from the QR menu: PENDING, guest_id set, created_by_id null. */
  addGuestOrder(guest: BarGuest, items: { name: string; qty: number; price: number; mods?: string[] }[], opts: { status?: MockOrder['status']; minutesAgo?: number; note?: string | null } = {}): MockOrder {
    const total = items.reduce((t, it) => t + it.price * it.qty, 0);
    return this.api.seedOrder({
      status: opts.status ?? 'PENDING', channel: 'DINE_IN', total: money(total),
      created_at: min(opts.minutesAgo ?? 0),
      items: items.map((it) => ({
        product_name: it.name, quantity: it.qty,
        modifiers_json: it.mods ? { modifiers: it.mods.map((m, i) => ({ id: `m-${i}`, name: m, price_delta: '0' })) } : null,
      })),
      session_id: guest.session_id, guest_id: guest.id, created_by_id: null, customer_note: opts.note ?? null,
    });
  }

  private sessionOrders(sid: string) {
    return this.api.orders.filter((o) => o.session_id === sid && o.status !== 'VOID' && !o.bill_paid);
  }
  private sum(list: MockOrder[]) { return list.reduce((t, o) => t + Number(o.total), 0); }
  private unpaidOfGuest(gid: string) { return this.api.orders.filter((o) => o.guest_id === gid && o.status !== 'VOID' && !o.bill_paid); }

  guestRead(g: BarGuest) {
    return {
      ...g, customer_id: null, time_charge_amount: null, time_charge_order_id: null, minutes_so_far: 0,
      unpaid_total: money(this.sum(this.unpaidOfGuest(g.id))),
    };
  }

  billPreview(sid: string, guestId: string | null) {
    const orders = guestId ? this.unpaidOfGuest(guestId) : this.sessionOrders(sid);
    const lines = orders.flatMap((o) => o.items.map((it, i) => ({
      order_id: o.id, receipt_no: o.receipt_no, product_name: it.product_name, quantity: it.quantity,
      line_total: money(Number(o.total) / o.items.length), guest_id: o.guest_id ?? null, id: `${o.id}-${i}`,
    })));
    const fnb = this.sum(orders);
    return {
      lines, fnb_total: money(fnb), time_total: '0.00', amount: money(fnb),
      guests_pending_checkout: this.guests.filter((g) => g.session_id === sid && g.status !== 'CHECKED_OUT').map((g) => g.id),
    };
  }

  live() {
    return this.tables.filter((t) => t.is_active).map((t) => {
      const s = this.sessions.find((x) => x.table_id === t.id && !x.closed) ?? null;
      const guests = s ? this.guests.filter((g) => g.session_id === s.id) : [];
      return {
        id: t.id, name: t.name, zone: t.zone, capacity: t.capacity,
        session: s && { id: s.id, opened_at: s.opened_at, party_size: s.party_size, closed_at: s.closed_at, status: 'OPEN' },
        guests: guests.map((g) => this.guestRead(g)),
        unpaid_total: money(s ? this.sum(this.sessionOrders(s.id)) : 0),
        checkout_requested_count: guests.filter((g) => g.status === 'CHECKOUT_REQUESTED').length,
      };
    });
  }

  qr(t: BarTable) {
    return {
      table_id: t.id, table_name: t.name, code: t.code,
      url: this.guestAppUrl ? `${this.guestAppUrl}/t/${t.code}` : null,
      qr_png_base64: this.guestAppUrl ? this.qrPng : null,
    };
  }

  async handle(c: Call, route: Route): Promise<boolean> {
    const { method: m, path: p } = c;
    const q = new URL(`http://x${c.search}`).searchParams;
    let mt: RegExpExecArray | null;

    if (m === 'GET' && p === '/api/v1/modifier-groups') { await json(route, 200, []); return true; }
    if (m === 'GET' && /^\/api\/v1\/products\/[^/]+\/steps$/.test(p)) { await json(route, 200, []); return true; }
    if (m === 'GET' && p === '/api/v1/floor/tables') { await json(route, 200, this.tables); return true; }
    if (m === 'GET' && p === '/api/v1/floor/live') { await json(route, 200, this.live()); return true; }
    if (m === 'GET' && p === '/api/v1/table-sessions') {
      await json(route, 200, this.sessions.filter((s) => !s.closed).map((s) => ({
        id: s.id, table_id: s.table_id, status: 'OPEN', party_size: s.party_size, customer_id: null, opened_at: s.opened_at, closed_at: s.closed_at,
        rate_plan_id: 'rp-bar', rate_snapshot: { name: 'Bar tab', billing_mode: 'PER_TABLE_HOUR', hourly_rate: '0', grace_minutes: 0, rounding_increment_minutes: 1, min_charge_minutes: 0, daily_cap_amount: null, max_open_minutes: 1440 },
        time_charge_amount: null, time_charge_order_id: null, note: null,
      })));
      return true;
    }
    if (m === 'POST' && p === '/api/v1/table-sessions') {
      const b = c.body as { table_id: string };
      if (!this.ratePlans.some((r) => r.is_default)) { await err(route, 409, 'CONFLICT', 'This store isn’t set up for table ordering yet'); return true; }
      const s = this.openSession(b.table_id, 0);
      await json(route, 201, { id: s.id, table_id: s.table_id, status: 'OPEN', party_size: 0, customer_id: null, opened_at: s.opened_at, closed_at: null, rate_plan_id: 'rp', rate_snapshot: { name: 'Bar tab', billing_mode: 'PER_TABLE_HOUR', hourly_rate: '0', grace_minutes: 0, rounding_increment_minutes: 1, min_charge_minutes: 0, daily_cap_amount: null, max_open_minutes: 1440 }, time_charge_amount: null, time_charge_order_id: null, note: null });
      return true;
    }

    if ((mt = /^\/api\/v1\/floor\/tables\/([^/]+)\/qr(\/reissue)?$/.exec(p))) {
      if (this.api.role !== 'OWNER' && this.api.role !== 'MANAGER') { await err(route, 403, 'FORBIDDEN', 'Insufficient role'); return true; }
      const t = this.tables.find((x) => x.id === mt![1]);
      if (!t) { await err(route, 404, 'NOT_FOUND', 'no table'); return true; }
      if (mt[2] && m === 'POST') t.code = `${t.code}-r${++this.seq}`;
      await json(route, 200, this.qr(t));
      return true;
    }

    if ((mt = /^\/api\/v1\/table-sessions\/([^/]+)\/bill$/.exec(p)) && m === 'GET') {
      await json(route, 200, this.billPreview(mt[1], q.get('guest_id'))); return true;
    }
    if ((mt = /^\/api\/v1\/table-sessions\/([^/]+)\/bill\/promptpay-qr$/.exec(p)) && m === 'GET') {
      const b = this.billPreview(mt[1], q.get('guest_id'));
      await json(route, 200, { amount: b.amount, payload: '00020101021229370016A000000677010111', qr_png_base64: this.qrPng });
      return true;
    }
    if ((mt = /^\/api\/v1\/table-sessions\/([^/]+)\/guests\/([^/]+)\/checkout$/.exec(p)) && m === 'POST') {
      const g = this.guests.find((x) => x.id === mt![2]);
      if (!g) { await err(route, 404, 'NOT_FOUND', 'no guest'); return true; }
      g.status = 'CHECKED_OUT';
      g.left_at = new Date().toISOString();
      await json(route, 200, this.billPreview(mt[1], g.id));
      return true;
    }
    if ((mt = /^\/api\/v1\/table-sessions\/([^/]+)\/bill\/pay$/.exec(p)) && m === 'POST') {
      const b = c.body as { scope: 'GUEST' | 'TABLE'; guest_id?: string; payment_method: string; force?: boolean };
      const sid = mt[1];
      if (b.scope === 'GUEST') {
        const g = this.guests.find((x) => x.id === b.guest_id);
        if (!g || g.status !== 'CHECKED_OUT') { await err(route, 409, 'CONFLICT', 'Guest must check out before paying'); return true; }
        const orders = this.unpaidOfGuest(g.id);
        const amount = money(this.sum(orders));
        orders.forEach((o) => { o.bill_paid = true; });
        this.bills.push({ scope: 'GUEST', guest_id: g.id, payment_method: b.payment_method, amount });
        await json(route, 201, { id: this.id('bill'), scope: 'GUEST', amount });
        return true;
      }
      const seated = this.guests.filter((g) => g.session_id === sid && g.status !== 'CHECKED_OUT');
      if (seated.length && !b.force) { await err(route, 409, 'CONFLICT', 'Guests still seated'); return true; }
      seated.forEach((g) => { g.status = 'CHECKED_OUT'; });
      const orders = this.sessionOrders(sid);
      const amount = money(this.sum(orders));
      orders.forEach((o) => { o.bill_paid = true; });
      this.bills.push({ scope: 'TABLE', payment_method: b.payment_method, amount });
      await json(route, 201, { id: this.id('bill'), scope: 'TABLE', amount });
      return true;
    }
    if ((mt = /^\/api\/v1\/table-sessions\/([^/]+)\/close$/.exec(p)) && m === 'POST') {
      const s = this.sessions.find((x) => x.id === mt![1]);
      if (!s) { await err(route, 404, 'NOT_FOUND', 'no session'); return true; }
      s.closed_at = s.closed_at ?? new Date().toISOString();
      const settled = this.sessionOrders(s.id).length === 0;
      if (settled) s.closed = true;
      await json(route, 200, { settled });
      return true;
    }
    if ((mt = /^\/api\/v1\/table-sessions\/([^/]+)\/orders\/([^/]+)\/reassign$/.exec(p)) && m === 'POST') {
      const o = this.api.orders.find((x) => x.id === mt![2] && x.session_id === mt![1]);
      const gid = (c.body as { guest_id: string }).guest_id;
      if (!o || !this.guests.some((g) => g.id === gid)) { await err(route, 404, 'NOT_FOUND', 'no order/guest'); return true; }
      o.guest_id = gid;
      await json(route, 200, o);
      return true;
    }
    if ((mt = /^\/api\/v1\/orders\/([^/]+)\/void$/.exec(p)) && m === 'POST') {
      const o = this.api.orders.find((x) => x.id === mt![1]);
      if (!o) { await err(route, 404, 'NOT_FOUND', 'no order'); return true; }
      o.status = 'VOID';
      await json(route, 200, { ...o, void_reason: (c.body as { reason: string }).reason });
      return true;
    }

    if (p === '/api/v1/rate-plans') {
      if (m === 'GET') { await json(route, 200, this.ratePlans); return true; }
      if (m === 'POST') {
        const b = c.body as { name: string; billing_mode: string; hourly_rate: string; is_default?: boolean };
        if (!/^\d+(\.\d{1,2})?$/.test(b.hourly_rate)) { await err(route, 422, 'UNPROCESSABLE_ENTITY', 'hourly_rate'); return true; }
        const plan = { id: this.id('rp'), name: b.name, billing_mode: b.billing_mode, hourly_rate: b.hourly_rate, is_default: !!b.is_default, is_active: true };
        if (plan.is_default) this.ratePlans.forEach((r) => { r.is_default = false; });
        this.ratePlans.push(plan);
        await json(route, 201, plan);
        return true;
      }
    }

    if (m === 'GET' && p === '/api/v1/categories') {
      await json(route, 200, this.api.categories.map((x) => ({ ...x, created_at: 'x', updated_at: 'x', name_en: null, description: null, description_en: null, ...this.categories[x.id] })));
      return true;
    }
    if ((mt = /^\/api\/v1\/categories\/([^/]+)$/.exec(p)) && m === 'PATCH') {
      this.categories[mt[1]] = { ...this.categories[mt[1]], ...(c.body as object) };
      const base = this.api.categories.find((x) => x.id === mt![1]);
      await json(route, 200, { ...base, ...this.categories[mt[1]] });
      return true;
    }
    if (m === 'GET' && p === '/api/v1/products' && !c.search.includes('is_active')) {
      await json(route, 200, this.api.products.map((x) => ({
        id: x.id, store_id: STORE_ID, category_id: x.category_id, name: x.name, description: null, price: x.price, is_active: true,
        created_at: 'x', updated_at: 'x', name_en: null, description_en: null, tags: [], ...this.productExtra[x.id],
      })));
      return true;
    }
    if ((mt = /^\/api\/v1\/products\/([^/]+)$/.exec(p)) && m === 'PATCH') {
      const b = c.body as { tags?: string[] | null };
      if (b.tags && (b.tags.length > 10 || b.tags.some((t) => [...t].length > 30))) { await err(route, 422, 'UNPROCESSABLE_ENTITY', 'tags'); return true; }
      this.productExtra[mt[1]] = { ...this.productExtra[mt[1]], ...(c.body as object), ...(b.tags === null ? { tags: [] } : {}) };
      await json(route, 200, { id: mt[1], ...this.productExtra[mt[1]] });
      return true;
    }
    return false;
  }
}

/** mr.bar seed: self_ordering only, T2 busy (Nok + Guest 2 asking for the bill), T5 freshly scanned. */
export async function seedBar(api: MockApi): Promise<BarState> {
  const bar = new BarState(api);
  await bar.init();
  api.features = ['self_ordering'];
  api.categories = [
    { id: 'cat-classic', store_id: STORE_ID, name: 'คลาสสิก', sort_order: 1, is_active: true },
    { id: 'cat-signature', store_id: STORE_ID, name: 'ซิกเนเจอร์', sort_order: 2, is_active: true },
  ];
  api.products = [
    { id: 'p-mojito', name: 'โมฮิโต้', price: '180.00', category_id: 'cat-classic' },
    { id: 'p-negroni', name: 'เนโกรนี', price: '220.00', category_id: 'cat-classic' },
    { id: 'p-tiger', name: 'ไทเกอร์ สปริตซ์', price: '240.00', category_id: 'cat-signature' },
  ];

  const t2 = bar.openSession('t2', 50);
  const nok = bar.addGuest(t2.id, 'Nok', 'ACTIVE', 50);
  const g2 = bar.addGuest(t2.id, 'Guest 2', 'CHECKOUT_REQUESTED', 40);
  bar.addGuestOrder(nok, [{ name: 'โมฮิโต้', qty: 1, price: 180, mods: ['+1 shot'] }], { status: 'COMPLETED', minutesAgo: 45 });
  bar.addGuestOrder(g2, [{ name: 'เนโกรนี', qty: 1, price: 220 }], { status: 'IN_PROGRESS', minutesAgo: 6 });
  bar.addGuestOrder(nok, [{ name: 'ไทเกอร์ สปริตซ์', qty: 1, price: 240 }], { status: 'READY', minutesAgo: 12, note: 'ไม่ใส่น้ำแข็ง' });

  bar.openSession('t5', 1);
  bar.addGuest('ses-t5', 'Guest 1', 'ACTIVE', 1);

  api.extra.push((c, route) => bar.handle(c, route));
  return bar;
}
