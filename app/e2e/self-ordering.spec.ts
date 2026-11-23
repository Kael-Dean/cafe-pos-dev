import { test as base, expect, type Page, type Route } from '@playwright/test';
import { MockApi, type MockOrder } from './support/mock-api';

/**
 * Table-QR self-ordering (mr.bar): order board, tables overview, checkout order, QR print page.
 * The whole API is mocked at the BFF boundary — nothing here can touch staging.
 *
 * Tablet / desktop only: the bar runs on a landscape Samsung tablet.
 */

type Ctx = { api: MockApi; app: Page };

const SESSION = 'sess-1';
const GUEST_A = 'guest-a';
const GUEST_B = 'guest-b';

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const guest = (id: string, label: string, status: string, unpaid: string) => ({
  id, session_id: SESSION, label, status, arrived_at: '2026-10-18T14:03:11Z',
  checkout_requested_at: status === 'CHECKOUT_REQUESTED' ? '2026-10-18T15:00:00Z' : null,
  left_at: null, customer_id: null, time_charge_amount: null, time_charge_order_id: null,
  minutes_so_far: 0, unpaid_total: unpaid,
});

// 1x1 transparent PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function installBar(api: MockApi, opts: { urlConfigured?: boolean } = {}) {
  const urlConfigured = opts.urlConfigured ?? true;
  api.features = ['self_ordering'];
  api.seedOrder({
    status: 'PENDING', session_id: SESSION, total: '180.00',
    items: [{ product_name: 'โมฮิโต้', quantity: 2, modifiers_json: { modifiers: [{ id: 'm1', name: '+1 shot' }] } }],
    ...({ guest_id: GUEST_A, created_by_id: null, customer_note: 'หวานน้อย' } as object),
  });

  const unpaidA = { value: '180.00' };
  let guestAStatus = 'CHECKOUT_REQUESTED';
  let closed = false;

  api.extra.push(async (c, route) => {
    const { method: m, path: p } = c;
    if (m === 'GET' && p === '/api/v1/rate-plans') {
      await json(route, 200, [{ id: 'rp1', name: 'Bar tab', billing_mode: 'PER_TABLE_HOUR', hourly_rate: '0', grace_minutes: 0, rounding_increment_minutes: 30, min_charge_minutes: 0, daily_cap_amount: null, max_open_minutes: 720, is_default: true, is_active: true }]);
      return true;
    }
    if (m === 'GET' && p === '/api/v1/floor/tables') {
      await json(route, 200, [
        { id: 't1', name: 'T1', zone: null, capacity: 4, is_active: true },
        { id: 't2', name: 'T2', zone: null, capacity: 4, is_active: true },
      ]);
      return true;
    }
    if (m === 'GET' && p === '/api/v1/floor/live') {
      await json(route, 200, {
        tables: [
          {
            table: { id: 't1', name: 'T1', zone: null, capacity: 4, is_active: true },
            session: closed ? null : {
              id: SESSION, party_size: 2, opened_at: '2026-10-18T14:00:00Z', elapsed_minutes: 60, billing_preview: {},
              games_out: [], unpaid_orders: 1, unpaid_total: unpaidA.value, over_max_duration: false,
              guests: [guest(GUEST_A, 'Nok', guestAStatus, unpaidA.value), guest(GUEST_B, 'Guest 2', 'ACTIVE', '0.00')],
              checkout_requested_count: guestAStatus === 'CHECKOUT_REQUESTED' ? 1 : 0,
            },
            reservation_next: null,
          },
          { table: { id: 't2', name: 'T2', zone: null, capacity: 4, is_active: true }, session: null, reservation_next: null },
        ],
      });
      return true;
    }
    const qr = /^\/api\/v1\/floor\/tables\/(t\d)\/qr$/.exec(p);
    if (m === 'GET' && qr) {
      const ok = urlConfigured && qr[1] === 't1';
      await json(route, 200, { table_id: qr[1], table_name: qr[1].toUpperCase(), code: `code-${qr[1]}`, url: ok ? `https://mrbar.example/t/code-${qr[1]}` : null, qr_png_base64: ok ? PNG : null });
      return true;
    }
    if (m === 'POST' && /\/qr\/reissue$/.test(p)) {
      await json(route, 200, { table_id: 't1', table_name: 'T1', code: 'new-code', url: 'https://mrbar.example/t/new-code', qr_png_base64: PNG });
      return true;
    }
    if (m === 'GET' && p === `/api/v1/table-sessions/${SESSION}/bill`) {
      const g = new URLSearchParams(c.search).get('guest_id');
      const amount = g === GUEST_A ? unpaidA.value : g ? '0.00' : unpaidA.value;
      await json(route, 200, {
        scope: g ? 'GUEST' : 'TABLE', session_id: SESSION, guest_id: g, fnb_total: amount, time_total: '0.00', time_preview_amount: '0.00', amount,
        lines: amount === '0.00' ? [] : [{ order_id: 'ord-x', receipt_no: 'IV-001', guest_label: g ? 'Nok' : null, total: amount, is_time_charge: false }],
        guests_pending_checkout: [],
      });
      return true;
    }
    if (m === 'POST' && p === `/api/v1/table-sessions/${SESSION}/guests/${GUEST_A}/checkout`) {
      guestAStatus = 'CHECKED_OUT';
      await json(route, 200, { scope: 'GUEST', session_id: SESSION, guest_id: GUEST_A, lines: [], fnb_total: '180.00', time_total: '0.00', time_preview_amount: '0.00', amount: '180.00', guests_pending_checkout: [] });
      return true;
    }
    if (m === 'POST' && p === `/api/v1/table-sessions/${SESSION}/bill/pay`) {
      const b = c.body as { scope: string; guest_id?: string };
      // Real backend rule: paying a GUEST before their checkout is a 409.
      if (b.scope === 'GUEST' && guestAStatus !== 'CHECKED_OUT') {
        await json(route, 409, { error: { code: 'CONFLICT', message: 'guest not checked out' } });
        return true;
      }
      unpaidA.value = '0.00';
      await json(route, 201, { id: 'bill-1', scope: b.scope, session_id: SESSION, guest_id: b.guest_id ?? null, amount: '180.00', payment_method: 'CASH', payment_ref: null, paid_at: '2026-10-18T15:05:00Z', order_ids: ['ord-x'], promptpay_payload: null, promptpay_qr_png_base64: null });
      return true;
    }
    if (m === 'POST' && p === `/api/v1/table-sessions/${SESSION}/close`) {
      closed = true;
      await json(route, 200, { settled: true, session: {}, time_charge: {}, unpaid_orders: [] });
      return true;
    }
    if (m === 'POST' && /\/void$/.test(p)) {
      const id = p.split('/')[4];
      const o = api.orders.find((q) => q.id === id);
      if (o) o.status = 'VOID';
      await json(route, 200, o ?? {});
      return true;
    }
    return false;
  });
}

const test = base.extend<Ctx>({
  api: async ({ page }, provide) => {
    const api = new MockApi();
    await api.install(page);
    await provide(api);
  },
  app: async ({ page, context, api, baseURL }, provide) => {
    installBar(api);
    await api.signIn(context, baseURL!);
    await page.goto('/');
    await expect(page.locator('aside [data-nav-id="order-board"]')).toBeAttached();
    await provide(page);
  },
});

async function goTo(page: Page, screen: string) {
  const item = page.locator(`aside [data-nav-id="${screen}"]`);
  if (!(await item.isVisible())) {
    const group = page.locator('#sb-group-sec-boardgame');
    if (await group.count()) await group.click();
  }
  await item.click();
  await expect(page.locator(`[data-nav-id="${screen}"][aria-current="page"]`).first()).toBeAttached();
}

test.beforeEach(async ({}, info) => {
  test.skip(info.project.name === 'mobile-375', 'bar tablet is landscape');
});

test('order board: NEW TABLE badge, note, accept moves the order to "กำลังทำ"', async ({ app, api }) => {
  await goTo(app, 'order-board');
  const card = app.getByRole('article', { name: /ออเดอร์/ }).first();
  await expect(card).toContainText('NEW TABLE');
  await expect(card).toContainText('T1');
  await expect(card).toContainText('Nok');
  await expect(card).toContainText('หวานน้อย');
  await expect(card).toContainText('+1 shot');

  await card.getByRole('button', { name: /^รับออเดอร์/ }).click();
  await expect.poll(() => api.find('PATCH', /\/status$/).map((c) => c.body)).toEqual([{ status: 'IN_PROGRESS' }]);
  await expect(app.getByRole('region', { name: 'กำลังทำ' }).getByRole('article')).toHaveCount(1);
  await expect(app.getByRole('button', { name: /^เสร็จแล้ว/ })).toBeVisible();
});

test('order board: reject sends void with a reason and restock', async ({ app, api }) => {
  await goTo(app, 'order-board');
  await app.getByRole('button', { name: /^ปฏิเสธออเดอร์/ }).click();
  await app.getByRole('radio', { name: 'ของหมด' }).click();
  await app.getByRole('button', { name: 'ยืนยันปฏิเสธ' }).click();
  await expect.poll(() => api.find('POST', /\/void$/).map((c) => c.body)).toEqual([{ reason: 'ของหมด', restock: true }]);
  await expect(app.getByRole('region', { name: 'ออเดอร์ใหม่' }).getByRole('article')).toHaveCount(0);
});

test('order board: sound button is offered and a pending order raises the global banner on other screens', async ({ app }) => {
  await goTo(app, 'floor');
  await expect(app.getByRole('button', { name: /มีออเดอร์ใหม่/ })).toBeVisible();
  await expect(app.getByRole('button', { name: /เปิดเสียงแจ้งเตือน/ })).toBeVisible();
});

test('tables overview highlights the table asking for the bill', async ({ app }) => {
  await goTo(app, 'floor');
  const tile = app.getByRole('button', { name: /โต๊ะ T1 .*ขอเช็คบิล 1 คน/ });
  await expect(tile).toBeVisible();
  await expect(tile).toContainText('Nok');
  await expect(tile).toContainText('฿180');
  // no time UI at a self-ordering bar
  await expect(app.getByText(/จับเวลา|ค่าเวลา/)).toHaveCount(0);
});

test('checkout runs preview → checkout → pay (GUEST, cash) → pay TABLE → close, in that order', async ({ app, api }) => {
  await goTo(app, 'floor');
  await app.getByRole('button', { name: /โต๊ะ T1 / }).click();
  await app.getByRole('button', { name: 'เช็คบิล Nok' }).click();

  await app.getByRole('radio', { name: /เงินสด/ }).click();
  await app.getByRole('button', { name: /รับเงินสด ฿180/ }).click();
  await expect.poll(() => api.find('POST', `/api/v1/table-sessions/${SESSION}/bill/pay`).length).toBe(1);

  const seq = api.calls
    .filter((c) => c.path.startsWith(`/api/v1/table-sessions/${SESSION}/`) && c.method !== 'GET' || (c.method === 'GET' && c.path.endsWith('/bill') && c.search.includes('guest_id')))
    .map((c) => `${c.method} ${c.path.replace(`/api/v1/table-sessions/${SESSION}`, '')}${c.search ? '?' + c.search.slice(1) : ''}`);
  const iPreview = seq.findIndex((s) => s.startsWith('GET /bill?guest_id'));
  const iCheckout = seq.findIndex((s) => s.includes('/checkout'));
  const iPay = seq.findIndex((s) => s.includes('/bill/pay'));
  expect(iPreview).toBeGreaterThanOrEqual(0);
  expect(iCheckout).toBeGreaterThan(iPreview);
  expect(iPay).toBeGreaterThan(iCheckout);
  expect(api.find('POST', `/api/v1/table-sessions/${SESSION}/bill/pay`)[0].body).toEqual({ scope: 'GUEST', guest_id: GUEST_A, payment_method: 'CASH' });

  // Nothing left on the table → close
  await app.getByRole('button', { name: 'ปิดโต๊ะ', exact: true }).click();
  await expect(app.getByText('ปิดโต๊ะเรียบร้อย')).toBeVisible();
  expect(api.find('POST', `/api/v1/table-sessions/${SESSION}/close`)).toHaveLength(1);
});

test('checkout: rest of the table pays scope TABLE with force, then closes', async ({ app, api }) => {
  await goTo(app, 'floor');
  await app.getByRole('button', { name: /โต๊ะ T1 / }).click();
  await app.getByRole('button', { name: 'เช็คบิล / ปิดโต๊ะ' }).click();
  await app.getByRole('button', { name: /รับเงินสดที่เหลือ ฿180 แล้วปิดโต๊ะ/ }).click();
  await expect(app.getByText('ปิดโต๊ะเรียบร้อย')).toBeVisible();
  expect(api.find('POST', `/api/v1/table-sessions/${SESSION}/bill/pay`)[0].body).toEqual({ scope: 'TABLE', payment_method: 'CASH', force: true });
  expect(api.find('POST', `/api/v1/table-sessions/${SESSION}/close`)).toHaveLength(1);
});

test('QR print page: sticker per table, setup hint when url is null, reissue needs confirmation', async ({ app, api }) => {
  await goTo(app, 'table-qr');
  await expect(app.getByRole('img', { name: 'QR สำหรับโต๊ะ T1' })).toBeVisible();
  await expect(app.getByText('https://mrbar.example/t/code-t1')).toBeVisible();
  await expect(app.getByText(/ยังไม่ได้ตั้ง guest_app_url/).first()).toBeVisible();

  await app.getByRole('button', { name: 'ออก QR ใหม่ โต๊ะ T1' }).click();
  await expect(app.getByText(/สติกเกอร์เดิมของโต๊ะนี้จะใช้ไม่ได้ทันที/)).toBeVisible();
  await expect(app.getByText(/ยังสั่งต่อได้/)).toBeVisible();
  expect(api.find('POST', /\/qr\/reissue$/)).toHaveLength(0); // not yet
  await app.getByRole('button', { name: 'ยืนยันออก QR ใหม่' }).click();
  await expect.poll(() => api.find('POST', /\/qr\/reissue$/).length).toBe(1);
});

test('QR print page is not offered to non-admin roles', async ({ page, context, api, baseURL }) => {
  api.role = 'BARISTA';
  installBar(api);
  await api.signIn(context, baseURL!);
  await page.goto('/');
  await expect(page.locator('aside [data-nav-id="order-board"]')).toBeAttached();
  await expect(page.locator('aside [data-nav-id="table-qr"]')).toHaveCount(0);
});

// keep the type import used (seedOrder extras are widened above)
export type { MockOrder };
