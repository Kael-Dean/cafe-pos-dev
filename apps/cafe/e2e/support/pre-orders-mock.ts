import type { Route } from '@playwright/test';
import type { Call, MockApi } from './mock-api';
import { addDaysIso, mondayOf } from '../../../../packages/pos-core/lib/pre-order-dates';

/**
 * Stateful stand-in for handoff pre-orders/calendar-handoff.md, layered on MockApi.extra:
 *
 *     GET /pre-orders?status&due_date_from&due_date_to&page&limit · GET /pre-orders/{id}
 *     GET /hr/staff · GET /hr/shifts?week_start   (the work calendar around them)
 *
 * The contract rules the screens must respect are enforced here too, so a spec fails
 * when the UI sends something the real backend would reject.
 */

const STORE_ID = 'store-e2e-1';

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });
const err = (route: Route, status: number, code: string, message: string) => json(route, status, { error: { code, message } });

/** Today in the browser's timezone (playwright.config pins Asia/Bangkok). */
export function bangkokToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

type PreOrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export interface MockPreOrder {
  id: string; order_date: string; due_date: string;
  customer_name: string | null; customer_phone: string | null;
  status: PreOrderStatus; item_count: number; created_at: string;
}

export class PreOrdersState {
  // ── pre-orders ──
  today = bangkokToday();
  monday = mondayOf(this.today);
  preOrders: MockPreOrder[] = [];

  constructor(private api: MockApi) {
    const d = (n: number) => addDaysIso(this.monday, n);
    const po = (id: string, due: string, name: string | null, phone: string | null, status: PreOrderStatus, items: number): MockPreOrder => ({
      id, order_date: addDaysIso(due, -5), due_date: due, customer_name: name, customer_phone: phone,
      status, item_count: items, created_at: `${addDaysIso(due, -5)}T09:00:00+07:00`,
    });
    this.preOrders = [
      // Outside the visible week on both sides — must never be requested for this week.
      po('po-prev', d(-1), 'สัปดาห์ก่อน', null, 'PENDING', 1),
      po('po-next', d(7), 'สัปดาห์หน้า', null, 'PENDING', 1),
      // This week
      po('po-mon', d(0), 'คุณเอ (เค้กวันเกิด 2 ปอนด์)', '0812345678', 'PENDING', 3),
      po('po-wed-1', d(2), 'ร้านกาแฟข้างบ้าน', null, 'IN_PROGRESS', 2),
      po('po-wed-2', d(2), null, '0899999999', 'PENDING', 1),
      po('po-wed-3', d(2), 'คุณบี', null, 'COMPLETED', 4),
      po('po-wed-4', d(2), 'คุณซี', null, 'PENDING', 1),
      po('po-wed-x', d(2), 'ยกเลิกแล้ว', null, 'CANCELLED', 1),
      po('po-sat', d(5), null, null, 'PENDING', 0),
    ];
  }

  async handle(c: Call, route: Route): Promise<boolean> {
    const { method: m, path: p } = c;
    const q = new URL(`http://x${c.search}`).searchParams;

    // ── pre-orders ────────────────────────────────────────────────────────────
    if (m === 'GET' && p === '/api/v1/pre-orders') {
      const from = q.get('due_date_from');
      const to = q.get('due_date_to');
      const status = q.get('status');
      const page = Number(q.get('page') ?? 1);
      const limit = Number(q.get('limit') ?? 50);
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if ((from && !iso.test(from)) || (to && !iso.test(to)) || !(limit >= 1 && limit <= 200) || !(page >= 1)) {
        await err(route, 422, 'VALIDATION_ERROR', 'bad query'); return true;
      }
      const rows = this.preOrders
        .filter((x) => (!from || x.due_date >= from) && (!to || x.due_date <= to) && (!status || x.status === status))
        .sort((a, b) => a.due_date.localeCompare(b.due_date));
      await json(route, 200, { items: rows.slice((page - 1) * limit, page * limit), total: rows.length });
      return true;
    }
    const poDetail = /^\/api\/v1\/pre-orders\/([^/]+)$/.exec(p);
    if (m === 'GET' && poDetail) {
      const x = this.preOrders.find((r) => r.id === poDetail[1]);
      if (!x) { await err(route, 404, 'PRE_ORDER_NOT_FOUND', 'not found'); return true; }
      await json(route, 200, {
        ...x, store_id: STORE_ID, customer_id: null, deposit_amount: '500.00', deposit_paid: true, notes: 'ใส่ช็อกโกแลตเพิ่ม',
        created_by_id: 'user-e2e-1', started_by_id: null, completed_by_id: null, started_at: null, completed_at: null,
        updated_at: x.created_at,
        items: Array.from({ length: x.item_count }, (_, i) => ({
          id: `${x.id}-i${i}`, product_id: 'p-croissant', product_name: `เค้กชิ้นที่ ${i + 1}`, quantity: 1,
          unit_price: '350.00', line_total: '350.00', fulfillment_mode: null,
        })),
      });
      return true;
    }

    // ── work calendar (shift schedule) ────────────────────────────────────────
    if (m === 'GET' && p === '/api/v1/hr/staff') {
      await json(route, 200, [
        { id: 'user-e2e-1', name: 'เจ้าของ E2E', role: 'OWNER', is_active: true, store_id: STORE_ID },
        { id: 'user-e2e-2', name: 'บาริสต้า สมชาย', role: 'BARISTA', is_active: true, store_id: STORE_ID },
      ]);
      return true;
    }
    if (m === 'GET' && p === '/api/v1/hr/shifts') {
      const ws = q.get('week_start') ?? this.monday;
      await json(route, 200, [
        { id: 'sh-1', user_id: 'user-e2e-2', assignment_date: ws, start_time: '08:00:00', end_time: '16:00:00', store_id: STORE_ID },
      ]);
      return true;
    }
    void this.api;
    return false;
  }
}

export function installPreOrders(api: MockApi): PreOrdersState {
  const state = new PreOrdersState(api);
  api.extra.push((c, route) => state.handle(c, route));
  return state;
}
