import type { Route } from '@playwright/test';
import type { Call, MockApi } from './mock-api';
import { moneyToSatang, satangToMoney, subMoney } from '../../../../packages/pos-core/lib/money';

/**
 * Stateful stand-in for handoff session-reconciliation/api-handoff.md, layered on MockApi.extra:
 *
 *   GET   /hr/cash-sessions/current            (an open session)
 *   GET   /hr/payment-groups                   (saved config or the 2-bucket default)
 *   PATCH /hr/payment-groups                   (MANAGER/OWNER; 422 unless every method is in exactly one group)
 *   GET   /hr/cash-sessions/{id}/summary       (system_total per group from PAID sales by method)
 *   PATCH /hr/cash-sessions/{id}/close         (409 when closed; 422 unless one entry per configured group)
 *
 * The validation mirrors the handoff's rules so a spec fails when the UI sends a payload
 * the real backend would reject.
 */

const STORE_ID = 'store-e2e-1';
const METHODS = ['CASH', 'CARD', 'QR_PROMPTPAY', 'LINE_PAY', 'TRUEMONEY', 'OTHER'] as const;
type Method = (typeof METHODS)[number];
interface Group { name: string; methods: Method[] }

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });
const err = (route: Route, status: number, code: string, message: string) => json(route, status, { error: { code, message } });

export class CashState {
  groups: Group[] = [
    { name: 'Cash', methods: ['CASH'] },
    { name: 'Online', methods: ['CARD', 'QR_PROMPTPAY', 'LINE_PAY', 'TRUEMONEY', 'OTHER'] },
  ];
  /** PAID sales in the session window, by method. Online = 8000 + 4800.50 = 12800.50. */
  salesByMethod: Record<Method, string> = {
    CASH: '4250.00', CARD: '8000.00', QR_PROMPTPAY: '4800.50', LINE_PAY: '0.00', TRUEMONEY: '0.00', OTHER: '0.00',
  };
  session = {
    id: 'cs-1', store_id: STORE_ID, opened_by_id: 'user-e2e-1', closed_by_id: null as string | null,
    cash_open: '500.00', cash_close: null as string | null,
    opened_at: '2026-06-07T08:00:00+07:00', closed_at: null as string | null, notes: null as string | null,
    created_at: '2026-06-07T08:00:00+07:00', updated_at: '2026-06-07T08:00:00+07:00',
  };
  /** Bodies the UI sent, for assertions. */
  closeBodies: unknown[] = [];
  groupBodies: unknown[] = [];

  constructor(private api: MockApi) {}

  private systemTotal(methods: readonly Method[]): string {
    let s = BigInt(0);
    for (const m of methods) s += moneyToSatang(this.salesByMethod[m]) ?? BigInt(0);
    return satangToMoney(s);
  }

  private manager(): boolean { return this.api.role === 'OWNER' || this.api.role === 'MANAGER'; }

  async handle(c: Call, route: Route): Promise<boolean> {
    const { method: m, path: p } = c;

    if (m === 'GET' && p === '/api/v1/hr/cash-sessions/current') {
      await json(route, 200, this.session.closed_at ? null : this.session);
      return true;
    }

    if (p === '/api/v1/hr/payment-groups') {
      if (m === 'GET') { await json(route, 200, this.groups); return true; }
      if (m === 'PATCH') {
        this.groupBodies.push(c.body);
        if (!this.manager()) { await err(route, 403, 'FORBIDDEN', 'manager only'); return true; }
        const body = c.body as Group[];
        const seen = new Map<string, number>();
        const ok = Array.isArray(body) && body.length > 0 && body.every((g) =>
          typeof g.name === 'string' && g.name.length >= 1 && g.name.length <= 100 &&
          Array.isArray(g.methods) && g.methods.length >= 1 && g.methods.every((x) => (METHODS as readonly string[]).includes(x)));
        if (ok) for (const g of body) for (const x of g.methods) seen.set(x, (seen.get(x) ?? 0) + 1);
        if (!ok || METHODS.some((x) => seen.get(x) !== 1)) {
          await err(route, 422, 'VALIDATION_ERROR', 'each payment method must appear in exactly one group'); return true;
        }
        this.groups = body.map((g) => ({ name: g.name, methods: [...g.methods] }));
        await json(route, 200, this.groups);
        return true;
      }
    }

    const sum = /^\/api\/v1\/hr\/cash-sessions\/([^/]+)\/summary$/.exec(p);
    if (m === 'GET' && sum) {
      if (!this.manager()) { await err(route, 403, 'FORBIDDEN', 'manager only'); return true; }
      if (sum[1] !== this.session.id) { await err(route, 404, 'NOT_FOUND', 'no session'); return true; }
      await json(route, 200, {
        session_id: this.session.id,
        period_from: this.session.opened_at,
        period_to: this.session.closed_at ?? '2026-06-07T20:14:00+07:00',
        groups: this.groups.map((g) => ({ name: g.name, methods: g.methods, system_total: this.systemTotal(g.methods) })),
      });
      return true;
    }

    const close = /^\/api\/v1\/hr\/cash-sessions\/([^/]+)\/close$/.exec(p);
    if (m === 'PATCH' && close) {
      this.closeBodies.push(c.body);
      if (!this.manager()) { await err(route, 403, 'FORBIDDEN', 'manager only'); return true; }
      if (close[1] !== this.session.id) { await err(route, 404, 'NOT_FOUND', 'no session'); return true; }
      if (this.session.closed_at) { await err(route, 409, 'CONFLICT', 'session already closed'); return true; }
      const body = c.body as { entries?: { group_name: string; actual_amount: string; notes: string | null }[]; cash_close?: unknown };
      const entries = body?.entries ?? [];
      const names = entries.map((e) => e.group_name);
      const valid = entries.length > 0 && body.cash_close === undefined &&
        new Set(names).size === names.length &&
        this.groups.every((g) => names.includes(g.name)) && names.every((n) => this.groups.some((g) => g.name === n)) &&
        entries.every((e) => /^\d+(\.\d{1,2})?$/.test(e.actual_amount) && (e.notes == null || e.notes.length <= 1000));
      if (!valid) { await err(route, 422, 'VALIDATION_ERROR', 'entries must contain exactly one entry per configured group'); return true; }
      const now = '2026-06-07T20:15:32+07:00';
      this.session = { ...this.session, closed_at: now, closed_by_id: 'user-e2e-1', updated_at: now };
      await json(route, 200, {
        ...this.session,
        cash_close: null,
        entries: entries.map((e, i) => {
          const g = this.groups.find((x) => x.name === e.group_name)!;
          const system = this.systemTotal(g.methods);
          return {
            id: `entry-${i + 1}`, session_id: this.session.id, group_name: g.name, methods: g.methods,
            system_total: system, actual_amount: e.actual_amount, variance: subMoney(e.actual_amount, system), notes: e.notes,
          };
        }),
      });
      return true;
    }
    return false;
  }
}

export function installCash(api: MockApi): CashState {
  const state = new CashState(api);
  // Ahead of the builtin "no open session" answer.
  api.extra.unshift((c, route) => state.handle(c, route));
  return state;
}
