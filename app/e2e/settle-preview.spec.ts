import type { Route } from '@playwright/test';
import { test, expect } from './support/fixtures';
import type { Call, MockApi } from './support/mock-api';

const SESSION = {
  id: 'sess-1',
  table_id: 'tbl-1',
  status: 'OPEN',
  party_size: 2,
  customer_id: null,
  opened_at: new Date(Date.now() - 65 * 60_000).toISOString(),
  closed_at: null,
  rate_plan_id: 'plan-1',
  rate_snapshot: {
    name: 'รายชั่วโมง', billing_mode: 'PER_TABLE', hourly_rate: '60.00', grace_minutes: 5,
    rounding_increment_minutes: 15, min_charge_minutes: 30, daily_cap_amount: null, max_open_minutes: 600,
  },
  time_charge_amount: null,
  time_charge_order_id: null,
  note: null,
};

const reply = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Floor + table-session endpoints for one open table "T1" with one unpaid food order. */
function installFloor(api: MockApi) {
  api.features = ['vertical.boardgame'];
  api.extra.push(async (c: Call, route: Route) => {
    const { method, path } = c;
    if (method === 'GET' && path === '/api/v1/floor/tables') {
      await reply(route, [{ id: 'tbl-1', name: 'T1', zone: 'โซน A', capacity: 4, is_active: true }]);
      return true;
    }
    if (method === 'GET' && path === '/api/v1/table-sessions') { await reply(route, [SESSION]); return true; }
    if (method === 'GET' && path === '/api/v1/rate-plans') { await reply(route, []); return true; }
    if (method === 'GET' && path === '/api/v1/table-sessions/sess-1/billing-preview') {
      await reply(route, { amount: '90.00', billable_minutes: 75, raw_minutes: 65, within_grace: false, cap_applied: false });
      return true;
    }
    if (method === 'GET' && path === '/api/v1/orders' && c.search.includes('status=PENDING')) {
      await reply(route, {
        items: [{ id: 'ord-tab-1', order_number: 7, receipt_no: 'IV2569-0007', total: '120.00', status: 'PENDING', session_id: 'sess-1' }],
        total: 1, page: 1, limit: 200,
      });
      return true;
    }
    if (method === 'POST' && path === '/api/v1/table-sessions/sess-1/close') {
      await reply(route, {
        session: { ...SESSION, status: 'CLOSED' },
        time_charge: { amount: '90.00', billable_minutes: 75, raw_minutes: 65, within_grace: false, cap_applied: false },
        unpaid_orders: [
          { id: 'ord-tab-1', receipt_no: 'IV2569-0007', total: '120.00', status: 'PENDING' },
          { id: 'ord-time-1', receipt_no: 'IV2569-0008', total: '90.00', status: 'PENDING' },
        ],
        settled: false,
      });
      return true;
    }
    if (method === 'PATCH' && /^\/api\/v1\/orders\/ord-(tab|time)-1\/pay$/.test(path)) {
      await reply(route, { id: path.split('/')[4], status: 'PAID', order_number: 7, total: '0', created_at: new Date().toISOString() });
      return true;
    }
    return false;
  });
}

test.describe('table settle: opening the sheet is a read-only preview', () => {
  test('opening, reading and closing Settle never calls close; confirming does', async ({ page, context, api, baseURL }) => {
    installFloor(api);
    await api.signIn(context, baseURL!);
    await page.goto('/?screen=floor');

    // Open the busy table, then "check bill".
    await page.getByRole('button', { name: /โต๊ะ T1 กำลังใช้/ }).click();
    await page.getByRole('button', { name: 'เช็คบิล' }).click();

    const settle = page.getByRole('dialog', { name: /เช็คบิล โต๊ะ T1/ });
    await expect(settle).toBeVisible();
    // Preview figures come from the server: time charge 90 + food 120 = 210.
    await expect(settle.getByText('ค่าเวลา').first()).toBeVisible();
    await expect(settle.getByText('#IV2569-0007')).toBeVisible();
    await expect(settle.locator('[aria-live="polite"]').filter({ hasText: 'ยอดรวมทั้งโต๊ะ' })).toContainText('฿210');
    await expect(settle.getByText('ค่าเวลาจะคำนวณจริงอีกครั้งตอนกดรับเงิน')).toBeVisible();

    // Reading it changed nothing on the server: no close, no pay, no void.
    expect(api.find('POST', '/api/v1/table-sessions/sess-1/close')).toHaveLength(0);
    expect(api.find('PATCH', /\/pay$/)).toHaveLength(0);
    expect(api.find('POST', /\/void$/)).toHaveLength(0);
    expect(api.find('GET', '/api/v1/table-sessions/sess-1/billing-preview').length).toBeGreaterThan(0);

    // "ไว้ก่อน" (later) leaves the clock running: still no close.
    await settle.getByRole('button', { name: 'ไว้ก่อน' }).click();
    await expect(settle).toHaveCount(0);
    expect(api.find('POST', '/api/v1/table-sessions/sess-1/close')).toHaveLength(0);

    // Escape and Back close it without side effects too.
    await page.getByRole('button', { name: /โต๊ะ T1 กำลังใช้/ }).click();
    await page.getByRole('button', { name: 'เช็คบิล' }).click();
    await expect(settle).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settle).toHaveCount(0);
    expect(api.find('POST', '/api/v1/table-sessions/sess-1/close')).toHaveLength(0);

    // Control: only confirming the tender (not opening the sheet) stops the clock.
    await page.getByRole('button', { name: /โต๊ะ T1 กำลังใช้/ }).click();
    await page.getByRole('button', { name: 'เช็คบิล' }).click();
    await expect(settle).toBeVisible();
    await settle.getByRole('button', { name: /^รับเงิน/ }).click();
    const pay = page.getByRole('dialog', { name: /รับเงินสด/ });
    await expect(pay).toBeVisible();
    expect(api.find('POST', '/api/v1/table-sessions/sess-1/close')).toHaveLength(0); // the tender sheet is still preview
    await pay.getByRole('button', { name: /พอดี/ }).click();
    await pay.getByRole('button', { name: /ยืนยันรับเงิน/ }).click();
    await expect.poll(() => api.find('POST', '/api/v1/table-sessions/sess-1/close').length).toBeGreaterThanOrEqual(1);
  });
});
