import path from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { MockApi } from './support/mock-api';
import { seedBar, type BarState } from './support/bar-seed';

/**
 * Table-QR self ordering, bar screens (handoff Part B + C) on the mr.bar setup:
 * a self_ordering store on the café edition, Samsung tablet landscape 1280×800.
 *
 *   order board: new guest order → loud alert + NEW TABLE → accept → ready → served; reject with reason
 *   floor: checkout-requested highlight · per-guest pay (checkout → PromptPay QR → pay) · rest of table + close
 *   walk-up order on a tab + reassign to a guest
 *   QR per table + print sheet + reissue · ฿0 "Bar tab" plan · bilingual product / category + tags
 *
 * Screenshots land in docs/qa/table-qr-bar/. Runs once (tablet-1024 project, resized).
 */

const SHOTS = path.resolve(__dirname, '../../../docs/qa/table-qr-bar');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

type Fixtures = { api: MockApi; bar: BarState; app: Page };

const test = base.extend<Fixtures>({
  api: async ({ page }, provide) => {
    const api = new MockApi();
    await api.install(page);
    await page.route(/^http:\/\/127\.0\.0\.1:8080\//, (r) => r.abort());
    await page.addInitScript(() => {
      localStorage.setItem('kafe:store-slug', 'e2e-shop');
      // Count synthesised alert notes (Web Audio) so the spec can see the alert fire.
      const w = window as unknown as { __alertNotes: number };
      w.__alertNotes = 0;
      const P = AudioContext.prototype;
      const orig = P.createOscillator;
      P.createOscillator = function (this: AudioContext) { w.__alertNotes++; return orig.call(this); };
    });
    await provide(api);
  },
  bar: async ({ api }, provide) => { await provide(await seedBar(api)); },
  app: async ({ page, context, api, bar, baseURL }, provide) => {
    void bar;
    await api.signIn(context, baseURL!);
    await page.goto('/');
    await expect(page.locator('aside [data-nav-id="guest-orders"]')).toBeVisible();
    await provide(page);
  },
});

test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'tablet-1024', 'bar screens: one landscape tablet run'); });

const GROUP: Record<string, string> = {
  'guest-orders': 'sec-service', pos: 'sec-service', floor: 'sec-boardgame', 'table-setup': 'sec-boardgame', catalog: 'sec-kitchen',
};
async function goTo(page: Page, screen: string) {
  const group = page.locator(`#sb-group-${GROUP[screen]}`);
  if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false') await group.click();
  await page.locator(`aside [data-nav-id="${screen}"]`).click();
  await expect(page.locator(`[data-nav-id="${screen}"][aria-current="page"]`).first()).toBeAttached();
}
const lane = (page: Page, status: string) => page.locator(`.gob-lane[data-status="${status}"]`);
const card = (scope: Locator, text: string) => scope.locator('.gob-card').filter({ hasText: text });

test('order board: alert + NEW TABLE, accept → ready → served, reject with a reason', async ({ app: page, api, bar }) => {
  await goTo(page, 'guest-orders');
  await expect(card(lane(page, 'IN_PROGRESS'), 'เนโกรนี')).toContainText('Guest 2');
  const ready = card(lane(page, 'READY'), 'ไทเกอร์ สปริตซ์');
  await expect(ready).toContainText('ไม่ใส่น้ำแข็ง');
  // T2's first order was served long ago: no NEW TABLE badge on a cold start.
  await expect(page.locator('.gob-newtable')).toHaveCount(0);

  // Audio unlocks on the first gesture anywhere (here: the sidebar tap), so the
  // board already shows the sound as on; the explicit unlock CTA covers a cold load.
  const cta = page.getByRole('button', { name: 'แตะเพื่อเปิดเสียงเตือน' });
  if (await cta.isVisible()) await cta.click();
  await expect(page.getByRole('button', { name: 'เสียงเตือน: เปิด' })).toBeVisible();
  await shot(page, '01-board-sound-on');

  // First guest order on T5 arrives (no Pusher in e2e → the 5 s poll picks it up).
  const before = await page.evaluate(() => (window as unknown as { __alertNotes: number }).__alertNotes);
  const guest1 = bar.guests.find((g) => g.session_id === 'ses-t5')!;
  bar.addGuestOrder(guest1, [{ name: 'โมฮิโต้', qty: 2, price: 180, mods: ['+1 shot', 'หวานน้อย'] }], { note: 'แก้วนึงไม่ใส่มินต์' });
  const fresh = card(lane(page, 'PENDING'), 'โมฮิโต้');
  await expect(fresh).toBeVisible({ timeout: 12_000 });
  await expect(fresh).toContainText('โต๊ะ T5');
  await expect(fresh).toContainText('Guest 1');
  await expect(fresh.locator('.gob-newtable')).toContainText('โต๊ะใหม่');
  await expect(fresh).toContainText('แก้วนึงไม่ใส่มินต์');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __alertNotes: number }).__alertNotes)).toBeGreaterThan(before);
  await shot(page, '02-new-guest-order-new-table');

  // Accept → making → ready → served.
  await fresh.getByRole('button', { name: 'รับออเดอร์' }).click();
  const making = card(lane(page, 'IN_PROGRESS'), 'โมฮิโต้');
  await expect(making).toBeVisible();
  await making.getByRole('button', { name: 'เสร็จแล้ว' }).click();
  const toServe = card(lane(page, 'READY'), 'โมฮิโต้');
  await expect(toServe).toBeVisible();
  await toServe.getByRole('button', { name: 'เสิร์ฟแล้ว' }).click();
  await expect(card(page.locator('.gob-lanes'), 'โมฮิโต้')).toHaveCount(0);
  const statusBodies = api.find('PATCH', /\/orders\/[^/]+\/status$/).map((c) => (c.body as { status: string }).status);
  expect(statusBodies).toEqual(['IN_PROGRESS', 'READY', 'COMPLETED']);

  // A second order on T2 — not the first on that tab, so no badge — rejected with a reason.
  const nok = bar.guests.find((g) => g.label === 'Nok')!;
  bar.addGuestOrder(nok, [{ name: 'เนโกรนี', qty: 1, price: 220 }]);
  const second = card(lane(page, 'PENDING'), 'Nok');
  await expect(second).toBeVisible({ timeout: 12_000 });
  await expect(second.locator('.gob-newtable')).toHaveCount(0);
  await second.getByRole('button', { name: 'ปฏิเสธ' }).click();
  const dialog = page.getByRole('dialog', { name: 'ปฏิเสธออเดอร์' });
  await dialog.getByText('ของหมด').click();
  await shot(page, '03-reject-reason');
  await dialog.getByRole('button', { name: 'ปฏิเสธออเดอร์นี้' }).click();
  await expect(dialog).toBeHidden();
  await expect(card(lane(page, 'PENDING'), 'Nok')).toHaveCount(0);
  expect(api.find('POST', /\/orders\/[^/]+\/void$/)[0].body).toEqual({ reason: 'ของหมด', restock: true });
  expect(api.unhandled).toEqual([]);
});

test('new guest order on another screen: banner jumps to the board', async ({ app: page, bar }) => {
  await goTo(page, 'floor');
  await expect(page.locator('.bf-tile').first()).toBeVisible();
  bar.addGuestOrder(bar.guests.find((g) => g.label === 'Guest 1')!, [{ name: 'เนโกรนี', qty: 1, price: 220 }]);
  const banner = page.locator('.bar-banner');
  await expect(banner).toContainText('ออเดอร์ใหม่จากโต๊ะ', { timeout: 12_000 });
  await expect(banner).toContainText('โต๊ะ T5');
  await shot(page, '04-banner-on-floor');
  await banner.getByRole('button', { name: 'ดูออเดอร์' }).click();
  await expect(card(lane(page, 'PENDING'), 'เนโกรนี')).toBeVisible();
  await expect(banner).toBeHidden();
});

test('floor: request-bill highlight, per-guest PromptPay, then the rest of the table + close', async ({ app: page, api }) => {
  await goTo(page, 'floor');
  const t2 = page.locator('.bf-tile', { hasText: 'T2' });
  await expect(t2).toHaveAttribute('data-state', 'request');
  await expect(t2).toContainText('ขอเช็คบิล 1');
  await expect(t2).toContainText('฿640');
  await expect(page.locator('.bf-tile', { hasText: 'T1' })).toHaveAttribute('data-state', 'free');
  await t2.click();
  const panel = page.locator('.bf-panel');
  await expect(panel.locator('.bf-guest', { hasText: 'Guest 2' })).toContainText('ขอเช็คบิล');
  await expect(panel.locator('.bf-guest', { hasText: 'Nok' })).toContainText('฿420');
  await expect(panel).not.toContainText('ค่าเวลา');
  await shot(page, '05-floor-checkout-requested');

  // Guest 2: checkout → PromptPay QR → paid.
  await panel.getByRole('button', { name: 'เก็บเงิน Guest 2' }).click();
  await expect(panel.locator('.bf-due')).toContainText('฿220');
  await panel.getByRole('button', { name: 'QR พร้อมเพย์' }).click();
  await expect(panel.getByRole('img', { name: /QR พร้อมเพย์/ })).toBeVisible();
  await shot(page, '06-guest-promptpay');
  await panel.getByRole('button', { name: 'ได้รับเงินแล้ว (พร้อมเพย์)' }).click();
  await expect(panel.locator('.bf-success')).toContainText('รับเงิน Guest 2 แล้ว ฿220');
  const writes = api.calls.filter((c) => c.method === 'POST' && /table-sessions/.test(c.path)).map((c) => c.path.split('/').slice(-2).join('/'));
  expect(writes).toEqual(['g-guest2-ses-t2/checkout', 'bill/pay']); // chained: checkout first
  expect(api.find('POST', /\/bill\/pay$/)[0].body).toEqual({ scope: 'GUEST', guest_id: 'g-guest2-ses-t2', payment_method: 'QR_PROMPTPAY' });

  // The rest (Nok, never checked out) → TABLE pay with force → close.
  await panel.getByRole('button', { name: 'กลับไปที่โต๊ะ' }).click();
  await panel.getByRole('button', { name: /เก็บเงินที่เหลือทั้งโต๊ะ ฿420/ }).click();
  await expect(panel).toContainText('แขกที่ยังนั่งอยู่ 1 คน');
  await panel.getByRole('button', { name: 'รับเงินสดแล้วปิดโต๊ะ' }).click();
  await expect(panel.locator('.bf-success')).toContainText('ปิดโต๊ะ T2 เรียบร้อย');
  await shot(page, '07-table-closed');
  expect(api.find('POST', /\/bill\/pay$/)[1].body).toEqual({ scope: 'TABLE', payment_method: 'CASH', force: true });
  expect(api.find('POST', /\/close$/)).toHaveLength(1);
  // The floor refetch turns T2 free; the panel follows (next scan opens a new tab).
  await expect(t2).toHaveAttribute('data-state', 'free', { timeout: 20_000 });
  await expect(panel).toContainText('โต๊ะว่าง');
});

test('walk-up order on a tab, then moved onto a guest', async ({ app: page, api }) => {
  api.seedOrder({
    status: 'IN_PROGRESS', total: '240.00', session_id: 'ses-t5', guest_id: null, created_by_id: 'user-e2e-1',
    items: [{ product_name: 'ไทเกอร์ สปริตซ์', quantity: 1, modifiers_json: null }],
  });
  await goTo(page, 'floor');
  await page.locator('.bf-tile', { hasText: 'T5' }).click();
  const panel = page.locator('.bf-panel');
  await expect(panel).toContainText('รายการจากร้าน (ยังไม่ระบุคน)');
  await panel.getByRole('button', { name: 'ย้ายไปบิลของ' }).click();
  await page.getByRole('option', { name: 'Guest 1' }).click();
  await panel.getByRole('button', { name: 'ย้าย', exact: true }).click();
  await expect(panel).not.toContainText('รายการจากร้าน', { timeout: 10_000 });
  await expect(panel.locator('.bf-guest', { hasText: 'Guest 1' })).toContainText('฿240');
  expect(api.find('POST', /\/reassign$/)[0].body).toEqual({ guest_id: 'g-guest1-ses-t5' });
  await shot(page, '08-walkup-reassigned');

  // "Order more" hands the tab to the POS (orders get session_id, no guest).
  await panel.getByRole('button', { name: 'สั่งเพิ่มให้โต๊ะนี้' }).click();
  await expect(page.getByText('กำลังลงบิลเข้าโต๊ะ T5')).toBeVisible();
});

test('QR: print sheet for every table, reissue with confirm', async ({ app: page, api }) => {
  await goTo(page, 'table-setup');
  await page.getByRole('button', { name: 'พิมพ์ QR ทุกโต๊ะ' }).click();
  const sheet = page.getByRole('dialog', { name: 'พิมพ์ QR ทุกโต๊ะ' });
  await expect(sheet.getByRole('img', { name: /QR สั่งอาหาร โต๊ะ/ })).toHaveCount(6);
  await expect(sheet.getByRole('button', { name: 'พิมพ์ 6 ใบ' })).toBeEnabled();
  await shot(page, '09-qr-print-sheet');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.qr-print-root')).toBeVisible();
  await expect(page.locator('.qr-print-page')).toHaveCount(1);
  await shot(page, '10-qr-print-media');
  await page.emulateMedia({ media: 'screen' });
  await sheet.getByRole('button', { name: 'ปิด', exact: true }).last().click();

  await page.getByRole('button', { name: 'QR โต๊ะ T5' }).click();
  const one = page.getByRole('dialog', { name: 'QR โต๊ะ T5' });
  await expect(one).toContainText('https://mrbar.example/t/c-t5');
  await one.getByRole('button', { name: 'ออก QR ใหม่' }).click();
  await expect(one).toContainText('สติกเกอร์อันเดิมจะสแกนไม่ได้ทันที');
  await shot(page, '11-qr-reissue-confirm');
  await one.getByRole('button', { name: 'ยืนยัน ออก QR ใหม่' }).click();
  await expect(one).toContainText(/c-t5-r\d+/);
  expect(api.find('POST', /\/qr\/reissue$/)).toHaveLength(1);
});

test('QR without a guest site URL explains what is missing', async ({ app: page, bar }) => {
  bar.guestAppUrl = null;
  await goTo(page, 'table-setup');
  await page.getByRole('button', { name: 'QR โต๊ะ T1' }).click();
  await expect(page.getByRole('dialog', { name: 'QR โต๊ะ T1' })).toContainText('ยังไม่ได้ตั้งค่าเว็บสั่งอาหารของร้าน');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'พิมพ์ QR ทุกโต๊ะ' }).click();
  const sheet = page.getByRole('dialog', { name: 'พิมพ์ QR ทุกโต๊ะ' });
  await expect(sheet.getByRole('button', { name: 'พิมพ์ 0 ใบ' })).toBeDisabled();
  await shot(page, '15-qr-no-guest-url');
});

test('฿0 "Bar tab" default plan from table setup', async ({ app: page, api }) => {
  await goTo(page, 'table-setup');
  await expect(page.getByText('ยังไม่มีแพ็กเกจเริ่มต้น')).toBeVisible();
  await page.getByRole('button', { name: 'สร้าง Bar tab ฿0' }).click();
  await expect(page.getByText('แพ็กเกจเริ่มต้น: Bar tab')).toBeVisible();
  await expect(page.getByText('ไม่คิดค่าเวลา — ลูกค้าจ่ายเฉพาะที่สั่ง')).toBeVisible();
  expect(api.find('POST', '/api/v1/rate-plans')[0].body).toEqual({
    name: 'Bar tab', billing_mode: 'PER_TABLE_HOUR', hourly_rate: '0', grace_minutes: 0, min_charge_minutes: 0, is_default: true,
  });
  await shot(page, '12-bar-tab-plan');
});

test('catalogue: bilingual product with tags, bilingual category', async ({ app: page, api }) => {
  await goTo(page, 'catalog');
  await page.getByRole('button', { name: 'สินค้า', exact: true }).click();
  await page.getByRole('button', { name: 'แก้ไข โมฮิโต้' }).click();
  const dlg = page.getByRole('dialog', { name: 'แก้ไขสินค้า' });
  await dlg.getByLabel('ชื่อภาษาอังกฤษ (เมนูลูกค้า)').fill('Mojito');
  await dlg.getByLabel('คำอธิบายภาษาอังกฤษ').fill('White rum · mint · lime · soda');
  const tags = dlg.getByLabel('แท็กบนเมนูลูกค้า');
  await tags.fill('สดชื่น');
  await tags.press('Enter');
  await tags.fill('Fresh, ความแรง: กลาง');
  await tags.press('Enter');
  await tags.fill('  fresh ');
  await tags.press('Enter');
  await expect(dlg.getByText('มีแท็กนี้แล้ว')).toBeVisible();
  await expect(dlg.locator('.tag-chip')).toHaveCount(3);
  await shot(page, '13-product-bilingual-tags');
  await dlg.getByRole('button', { name: 'บันทึก' }).click();
  await expect(dlg).toBeHidden();
  expect(api.find('PATCH', '/api/v1/products/p-mojito')[0].body).toEqual({
    name_en: 'Mojito', description_en: 'White rum · mint · lime · soda', tags: ['สดชื่น', 'Fresh', 'ความแรง: กลาง'],
  });

  // Clearing every tag sends null.
  await page.getByRole('button', { name: 'แก้ไข โมฮิโต้' }).click();
  for (let i = 0; i < 3; i++) await dlg.getByRole('button', { name: /^ลบแท็ก/ }).first().click();
  await dlg.getByRole('button', { name: 'บันทึก' }).click();
  await expect(dlg).toBeHidden();
  expect(api.find('PATCH', '/api/v1/products/p-mojito')[1].body).toEqual({ tags: null });

  await page.getByRole('button', { name: 'หมวดหมู่', exact: true }).click();
  await page.getByRole('button', { name: 'แก้ไข คลาสสิก' }).click();
  const cat = page.getByRole('dialog', { name: 'แก้ไขหมวดหมู่' });
  await cat.getByLabel('ชื่อภาษาอังกฤษ').fill('Classic');
  await cat.getByLabel('คำอธิบาย (แสดงบนเมนูลูกค้า)').fill('ของดั้งเดิม ทำให้ถึงเครื่อง');
  await cat.getByLabel('คำอธิบายภาษาอังกฤษ').fill('The originals, done properly');
  await shot(page, '14-category-bilingual');
  await cat.getByRole('button', { name: 'บันทึก' }).click();
  await expect(cat).toBeHidden();
  expect(api.find('PATCH', '/api/v1/categories/cat-classic')[0].body).toEqual({
    name_en: 'Classic', description: 'ของดั้งเดิม ทำให้ถึงเครื่อง', description_en: 'The originals, done properly',
  });
});
