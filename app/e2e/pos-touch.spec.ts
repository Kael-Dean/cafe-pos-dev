import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { MockApi } from './support/mock-api';
import { FIXED_NOW, MEMBER_ACCOUNT, MEMBER_PHONE, seedCaptureApi } from './support/seed';
import { MIN_TARGET, smallTargets } from './support/targets';

/**
 * Regression cover for the touch-first core flow (docs/specs/TOUCH-SPEC.md, commit dd77fc7):
 * optimistic add, modifiers, qty / remove + undo, member keypad, cash payment → receipt, void,
 * KDS bump + undo (held request), sidebar tiers, and a 44px touch-target guard.
 *
 * Runs in every project of playwright.config.ts (tablet-1024 touch, desktop-1440 mouse,
 * mobile-375 touch). Taps go through `press()`: a real touch tap where the project has touch,
 * a mouse click otherwise — both input paths must work on the counter (TOUCH-SPEC §1.4).
 *
 * Determinism: the page clock is installed at FIXED_NOW and flows normally. Anything that
 * depends on the 5s undo window is driven by the clock (pause → act → fastForward), never by
 * real waiting, so a slow machine cannot make the bar expire under the test.
 */

// ── fixtures ─────────────────────────────────────────────────────────────────
type Fixtures = {
  /** Mock BFF with the rich seed (catalogue with modifiers, member, KDS tickets). Not signed in. */
  api: MockApi;
  /** Signed in, POS loaded, details of the plain products used below already cached. */
  app: Page;
  /** Tap on touch projects, click otherwise. */
  press: (target: Locator) => Promise<void>;
};

/** Plain (no-modifier) products whose details must be in the cache for an instant add. */
const PLAIN = ['p-americano', 'p-espresso'];

const test = base.extend<Fixtures>({
  api: async ({ page }, provide) => {
    const api = new MockApi();
    seedCaptureApi(api);
    await api.install(page);
    await page.clock.install({ time: FIXED_NOW });
    // Never let the printer bridge (http://127.0.0.1:8080) leak a real request.
    await page.route(/^http:\/\/127\.0\.0\.1:8080\//, (r) => r.abort());
    // The device already knows its store (the Store ID step is covered by login.spec.ts).
    await page.addInitScript(() => localStorage.setItem('kafe:store-slug', 'e2e-shop'));
    await provide(api);
  },

  app: async ({ page, context, api, baseURL }, provide) => {
    await api.signIn(context, baseURL!);
    const cached = PLAIN.map((id) => page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/products/${id}`));
    await page.goto('/');
    await expect(menuCard(page, 'ลาเต้ร้อน')).toBeVisible();
    await Promise.all(cached);
    await provide(page);
  },

  press: async ({}, provide, info) => {
    const touch = !!info.project.use.hasTouch;
    await provide((l) => (touch ? l.tap() : l.click()));
  },
});

// ── helpers ──────────────────────────────────────────────────────────────────
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1024) < 768;
const visible = (l: Locator) => l.filter({ visible: true }).first();
const menuCard = (page: Page, name: string) => visible(page.locator('button.menu-card').filter({ hasText: name }));
const lines = (page: Page) => page.locator('.pos-cart .pos-line');
const line = (page: Page, name: string) => lines(page).filter({ has: page.locator('.pos-line-name', { hasText: name }) });
const qtyOf = (l: Locator) => l.locator('.pos-qty');
const undoBar = (page: Page) => page.locator('.undo-bar');
const toasts = (page: Page) => page.locator('.toast-stack > *');
const payButton = (page: Page, name: RegExp) => visible(page.getByRole('button', { name }));

async function showCart(page: Page): Promise<void> {
  if (isPhone(page)) await page.getByRole('tab', { name: /ตะกร้า/ }).click();
}
async function showMenu(page: Page): Promise<void> {
  if (isPhone(page)) await page.getByRole('tab', { name: /^เมนู/ }).click();
}

/** Stop page time where it is (timers do not fire until fastForward/runFor/resume). */
async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  // A margin: page time keeps flowing between the two calls, and pauseAt refuses the past.
  await page.clock.pauseAt(now + 1_000);
}

/** Add a plain product from the menu (switching back to the menu tab on phones). */
async function addPlain(page: Page, press: Fixtures['press'], name: string): Promise<void> {
  await showMenu(page);
  await press(menuCard(page, name));
  await expect(line(page, name)).toHaveCount(1);
}

const SCREEN_GROUP: Record<string, string> = { pos: 'sec-service', kds: 'sec-service' };

/** Navigate like a user: sidebar on tablet/desktop, bottom tabs or the menu sheet on phones. */
async function goTo(page: Page, press: Fixtures['press'], screen: string): Promise<void> {
  if (isPhone(page)) {
    const tab = page.locator(`.tabbar [data-tab-id="${screen}"]`);
    if (await tab.count()) {
      await press(tab);
    } else {
      await press(page.locator('.tabbar [data-tab-id="menu"]'));
      await press(page.locator(`.navsheet [data-nav-id="${screen}"]`));
    }
  } else {
    const group = page.locator(`#sb-group-${SCREEN_GROUP[screen]}`);
    if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false') await press(group);
    await press(page.locator(`aside [data-nav-id="${screen}"]`));
  }
  await expect(page.locator(`[data-nav-id="${screen}"][aria-current="page"], [data-tab-id="${screen}"][aria-current="page"]`).first()).toBeAttached();
}

function expectNoSmallTargets(report: Awaited<ReturnType<typeof smallTargets>>, where: string, info: TestInfo) {
  const msg = `${info.project.name} · ${where}: interactive elements < ${MIN_TARGET}px\n` +
    report.items.map((i) => `  ${i.selector} "${i.label}" ${i.width}x${i.height} @${i.x},${i.y}`).join('\n');
  expect(report.total, `${where}: collector found no targets at all`).toBeGreaterThan(5);
  expect(report.items, msg).toEqual([]);
}

// ── 1. login → instant add ───────────────────────────────────────────────────
test.describe('add to cart', () => {
  test('PIN login lands on POS; a plain product adds instantly with a qty badge and no toast', async ({ page, api, press }) => {
    await page.goto('/');
    const pad = page.locator('[aria-label="แป้น PIN"]');
    await expect(pad).toBeVisible();
    await expect(page.getByText('ยังไม่ได้ใส่ PIN')).toBeAttached();
    for (const d of '123456') await press(pad.getByRole('button', { name: d, exact: true }));
    await expect(menuCard(page, 'อเมริกาโน่')).toBeVisible();
    expect(api.find('POST', '/api/auth/login')).toHaveLength(1);
    // Instant add needs the product detail cached (background prefetch after the list loads).
    await expect.poll(() => api.find('GET', '/api/v1/products/p-americano').length).toBeGreaterThan(0);
    await expect(menuCard(page, 'อเมริกาโน่')).not.toHaveAttribute('aria-busy', 'true');

    const card = menuCard(page, 'อเมริกาโน่');
    await press(card);
    // The cart is the feedback: the line is there right after the tap (no network round trip).
    await expect(line(page, 'อเมริกาโน่')).toHaveCount(1, { timeout: 300 });
    await expect(card.locator('.pos-card-qty')).toHaveText('1', { timeout: 300 });
    await expect(card).toContainText('ในตะกร้า 1');
    if (isPhone(page)) await expect(page.locator('.pos-cartbar')).toContainText('1 รายการ');
    // …and no "added to cart" toast (TOUCH-SPEC §3.3).
    await expect(toasts(page)).toHaveCount(0);
    await expect(page.getByText('เพิ่มลงตะกร้า')).toHaveCount(0);

    await showCart(page);
    await expect(line(page, 'อเมริกาโน่')).toBeVisible();
    await expect(qtyOf(line(page, 'อเมริกาโน่'))).toHaveText('1');
    expect(api.unhandled).toEqual([]);
  });

  test('three rapid taps on a cached product → one line, qty 3', async ({ app, press }) => {
    const card = menuCard(app, 'เอสเพรสโซ่');
    await press(card);
    await press(card);
    await press(card);
    await expect(card.locator('.pos-card-qty')).toHaveText('3');
    await showCart(app);
    await expect(line(app, 'เอสเพรสโซ่')).toHaveCount(1);
    await expect(qtyOf(line(app, 'เอสเพรสโซ่'))).toHaveText('3');
    await expect(line(app, 'เอสเพรสโซ่')).toContainText('฿135');
    await expect(toasts(app)).toHaveCount(0);
  });

  test('taps while the product detail is still loading are queued, not dropped', async ({ app, api, press }) => {
    // Hold GET /products/p-brownie until released, so the card is deterministically pending.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    api.extra.unshift(async (c, route) => {
      if (c.method !== 'GET' || c.path !== '/api/v1/products/p-brownie') return false;
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'p-brownie', name: 'บราวนี่ช็อกโกแลต', price: '55.00', modifier_groups: [] }) });
      return true;
    });

    await press(visible(app.locator('button.pos-chip', { hasText: 'เบเกอรี่' })));
    const card = menuCard(app, 'บราวนี่ช็อกโกแลต');
    await press(card);
    await expect(card).toHaveAttribute('aria-busy', 'true');
    await press(card);
    await press(card);
    expect(await lines(app).count()).toBe(0); // nothing lands before the detail is known

    release();
    await expect(card).not.toHaveAttribute('aria-busy', 'true');
    await expect(card.locator('.pos-card-qty')).toHaveText('3');
    await showCart(app);
    await expect(lines(app)).toHaveCount(1);
    await expect(qtyOf(line(app, 'บราวนี่ช็อกโกแลต'))).toHaveText('3');
  });
});

// ── 2. modifiers ─────────────────────────────────────────────────────────────
test('product with options → modifier modal → choose → add; the line shows the modifiers', async ({ app, press }) => {
  await press(menuCard(app, 'ลาเต้ร้อน'));
  const dialog = app.getByRole('dialog', { name: 'ปรับแต่ง ลาเต้ร้อน' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.skeleton')).toHaveCount(0);
  for (const o of ['L', '50%', 'เพิ่มช็อต']) await press(dialog.getByRole('button', { name: new RegExp(`^${o}`) }));
  await press(dialog.locator('button.btn-primary'));
  await expect(dialog).toHaveCount(0);

  await showCart(app);
  const l = line(app, 'ลาเต้ร้อน');
  await expect(l).toHaveCount(1);
  await expect(l.locator('.pos-line-mods')).toContainText('L');
  await expect(l.locator('.pos-line-mods')).toContainText('50%');
  await expect(l.locator('.pos-line-mods')).toContainText('เพิ่มช็อต');
  await expect(l).toContainText('฿95'); // 60 + L 20 + shot 15
  await expect(toasts(app)).toHaveCount(0);
});

// ── 3. qty ± / remove / undo ─────────────────────────────────────────────────
test('qty + / −; − at 1 and trash both remove the line with an undo that restores it', async ({ app, press }) => {
  await addPlain(app, press, 'อเมริกาโน่');
  await showCart(app);
  const l = line(app, 'อเมริกาโน่');
  const stepper = l.getByRole('group', { name: 'อเมริกาโน่' });

  await press(stepper.getByRole('button', { name: 'เพิ่มจำนวน' }));
  await expect(qtyOf(l)).toHaveText('2');
  await expect(l).toContainText('฿100');
  await press(stepper.getByRole('button', { name: 'ลดจำนวน' }));
  await expect(qtyOf(l)).toHaveText('1');
  await expect(l).toContainText('฿50');

  // From here the 5s undo window is under clock control.
  await pauseClock(app);

  // − at qty 1 removes the line → undo bar → undo puts it back.
  await press(stepper.getByRole('button', { name: 'ลดจำนวน' }));
  await expect(l).toHaveCount(0);
  await expect(undoBar(app)).toContainText('ลบ อเมริกาโน่ แล้ว');
  await press(undoBar(app).getByRole('button', { name: 'เลิกทำ' }));
  await expect(undoBar(app)).toHaveCount(0);
  await expect(l).toHaveCount(1);
  await expect(qtyOf(l)).toHaveText('1');

  // Trash removes → undo.
  await press(l.getByRole('button', { name: 'ลบ อเมริกาโน่' }));
  await expect(l).toHaveCount(0);
  await expect(undoBar(app)).toBeVisible();
  await press(undoBar(app).getByRole('button', { name: 'เลิกทำ' }));
  await expect(l).toHaveCount(1);

  // Without undo the bar goes away after 5s and the line stays removed.
  await press(l.getByRole('button', { name: 'ลบ อเมริกาโน่' }));
  await expect(undoBar(app)).toBeVisible();
  await app.clock.fastForward(5_000);
  await expect(undoBar(app)).toHaveCount(0);
  await expect(lines(app)).toHaveCount(0);
  await app.clock.resume();
});

// ── 4. membership via keypad ─────────────────────────────────────────────────
test('attach a member with the on-screen keypad → member chip shows', async ({ app, api, press }) => {
  await addPlain(app, press, 'อเมริกาโน่');
  await showCart(app);
  await press(visible(app.locator('button.pos-head-btn').filter({ hasText: /^\s*สมาชิก\s*$/ })));
  const dialog = app.getByRole('dialog', { name: 'สมาชิก / สะสมแต้ม' });
  await expect(dialog).toBeVisible();
  // Phone entry is an on-screen keypad (no OS keyboard on a tablet).
  const phonePad = dialog.getByRole('group', { name: 'เบอร์โทรศัพท์', exact: true });
  for (const k of MEMBER_PHONE) await press(phonePad.getByRole('button', { name: k, exact: true }));
  const attach = dialog.getByRole('button', { name: 'แนบสมาชิกกับบิล' });
  await expect(attach).toBeVisible();
  expect(api.find('POST', '/api/v1/membership/lookup').map((c) => (c.body as { phone?: string }).phone)).toContain(MEMBER_PHONE);
  await press(attach);
  await expect(dialog).toHaveCount(0);

  const chip = visible(app.locator('.pos-member-chip'));
  await expect(chip).toContainText(MEMBER_ACCOUNT.customer_name);
  await expect(chip.getByRole('button', { name: 'นำสมาชิกออก' })).toBeVisible();
});

// ── 5. cash payment → receipt → empty cart ───────────────────────────────────
test('pay cash: keypad 500 → change → confirm → receipt → close → cart empty', async ({ app, api, press }) => {
  await addPlain(app, press, 'อเมริกาโน่'); // 50
  await addPlain(app, press, 'เอสเพรสโซ่'); // 45
  await showCart(app);
  await press(payButton(app, /^\s*เงินสด\s*$/));
  const dialog = app.getByRole('dialog', { name: 'รับเงินสด' });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: /ยืนยันรับเงิน/ });
  await expect(confirm).toBeDisabled();

  const keys = dialog.getByRole('group', { name: 'แป้นตัวเลข' });
  for (const k of '500') await press(keys.getByRole('button', { name: k, exact: true }));
  const result = dialog.locator('.cashpad-result');
  await expect(result).toHaveAttribute('data-tone', 'ok');
  await expect(result.locator('.cashpad-result-label')).toHaveText('เงินทอน');
  await expect(result.locator('.cashpad-result-value')).toHaveText('฿405'); // 500 − 95, once the count-up settles
  await expect(confirm).toBeEnabled();
  await press(confirm);

  const receipt = app.getByRole('dialog', { name: 'ใบเสร็จรับเงิน' });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('อเมริกาโน่');
  await expect(receipt).toContainText('เอสเพรสโซ่');
  const created = api.find('POST', '/api/v1/orders');
  expect(created).toHaveLength(1);
  expect((created[0].body as { items: { product_id: string; quantity: number }[] }).items.map((i) => [i.product_id, i.quantity]))
    .toEqual([['p-americano', 1], ['p-espresso', 1]]);
  expect(api.find('PATCH', /\/orders\/[^/]+\/pay$/)).toHaveLength(1);

  await press(receipt.getByRole('button', { name: 'ปิด' }).first());
  await expect(receipt).toHaveCount(0);
  await showCart(app);
  await expect(lines(app)).toHaveCount(0);
  await expect(visible(app.locator('.pos-empty'))).toBeVisible();
});

// ── 6. void bill ─────────────────────────────────────────────────────────────
test('void bill asks first; "keep" keeps the cart, confirm clears it without creating an order', async ({ app, api, press }) => {
  await addPlain(app, press, 'อเมริกาโน่');
  await addPlain(app, press, 'เอสเพรสโซ่');
  await showCart(app);
  const voidBtn = visible(app.locator('.pos-secondary').getByRole('button', { name: /ยกเลิกบิล/ }));

  await press(voidBtn);
  let dialog = app.getByRole('dialog', { name: 'ยกเลิกบิลนี้?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('ล้าง 2 รายการ');
  await press(dialog.getByRole('button', { name: 'เก็บบิลไว้' }));
  await expect(dialog).toHaveCount(0);
  await expect(lines(app)).toHaveCount(2);

  await press(voidBtn);
  dialog = app.getByRole('dialog', { name: 'ยกเลิกบิลนี้?' });
  await press(dialog.getByRole('button', { name: 'ยกเลิกบิล' }));
  await expect(dialog).toHaveCount(0);
  await expect(lines(app)).toHaveCount(0);
  await expect(undoBar(app)).toHaveCount(0);
  expect(api.find('POST', '/api/v1/orders')).toHaveLength(0);
});

// ── 7. KDS bump + undo (held request) ────────────────────────────────────────
test('KDS: undo a bump sends nothing; a bump left to expire sends exactly one IN_PROGRESS', async ({ app, api, press }) => {
  await goTo(app, press, 'kds');
  // The oldest-but-one PAID ticket in the seed: ลาเต้เย็น ×2 + ครัวซองต์ (status "new").
  const ticket = app.locator('.kds-ticket').filter({ hasText: 'ลาเต้เย็น' });
  await expect(ticket).toHaveCount(1);
  await expect(ticket).toContainText('ใหม่');
  const orderId = api.orders.find((o) => o.items.some((i) => i.product_name === 'ลาเต้เย็น'))!.id;
  const statusCalls = () => api.find('PATCH', `/api/v1/orders/${orderId}/status`);
  const bar = undoBar(app);

  await pauseClock(app);
  await press(ticket.getByRole('button', { name: 'เริ่มทำ' }));
  await expect(ticket).toContainText('กำลังทำ');
  await expect(bar).toBeVisible();
  await press(bar.getByRole('button', { name: 'เลิกทำ' }));
  await expect(bar).toHaveCount(0);
  await expect(ticket).toContainText('ใหม่');
  await expect(ticket.getByRole('button', { name: 'เริ่มทำ' })).toBeVisible();
  // Well past the undo window: the held request must have been dropped, not deferred.
  await app.clock.fastForward(6_000);
  await expect(ticket).toContainText('ใหม่');
  expect(statusCalls()).toHaveLength(0);

  // Bump again and let the bar expire → the held bump goes out, once.
  await press(ticket.getByRole('button', { name: 'เริ่มทำ' }));
  await expect(bar).toBeVisible();
  expect(statusCalls()).toHaveLength(0); // held while the bar shows
  await app.clock.fastForward(5_000);
  await expect(bar).toHaveCount(0);
  await expect.poll(() => statusCalls().length).toBe(1);
  expect(statusCalls()[0].body).toEqual({ status: 'IN_PROGRESS' });
  await app.clock.resume();
  await expect(ticket).toContainText('กำลังทำ');
  // Nothing else trickles out afterwards (e.g. a second commit on unmount / re-render).
  await app.clock.fastForward(6_000);
  expect(statusCalls()).toHaveLength(1);
  expect(api.find('PATCH', /\/status$/)).toHaveLength(1);
});

// ── 8. sidebar tiers ─────────────────────────────────────────────────────────
test('sidebar: 1024 = 80px labelled rail, expands as an overlay, Escape closes; 1440 = expanded', async ({ app, press }) => {
  test.skip(isPhone(app), 'phones have no sidebar (MobileNav instead)');
  const aside = app.locator('aside.sidebar-surface');
  const width = async () => (await aside.boundingBox())?.width;

  if ((app.viewportSize()?.width ?? 0) < 1280) {
    await expect.poll(width).toBe(80);
    // Visible short labels under the icons, not tooltip-only.
    await expect(aside.locator('[data-nav-id="pos"] .sb-rail-label')).toHaveText('ขาย');
    await expect(aside.locator('[data-nav-id="kds"] .sb-rail-label')).toHaveText('ครัว');
    await expect(aside.locator('[data-nav-id="kds"] .sb-rail-label')).toBeVisible();

    const menuBox = await visible(app.locator('.pos-menu')).boundingBox();
    await press(app.getByRole('button', { name: 'ขยายเมนู' }));
    await expect(app.locator('aside.sb-overlay')).toBeVisible();
    await expect.poll(width).toBe(240);
    await expect(app.getByRole('button', { name: 'ย่อเมนู' })).toBeVisible();
    // Overlay, not push: the POS menu column did not move or resize.
    expect(await visible(app.locator('.pos-menu')).boundingBox()).toEqual(menuBox);

    await app.keyboard.press('Escape');
    await expect(app.locator('aside.sb-overlay')).toHaveCount(0);
    await expect.poll(width).toBe(80);
    await expect(app.getByRole('button', { name: 'ขยายเมนู' })).toBeVisible();
  } else {
    await expect.poll(width).toBe(240);
    await expect(app.getByRole('button', { name: 'ย่อเมนู' })).toBeVisible();
    await expect(app.locator('aside.sb-overlay')).toHaveCount(0); // POS tier pushes, it does not overlay
  }
});

// ── 9. touch-target guard ────────────────────────────────────────────────────
test('touch targets: no visible clickable < 44px on POS with a cart and on the cash payment modal', async ({ app, press }, info) => {
  // A cart with a modifier line and a plain line (steppers, trash, member buttons, pay grid).
  await press(menuCard(app, 'ลาเต้ร้อน'));
  const mod = app.getByRole('dialog', { name: 'ปรับแต่ง ลาเต้ร้อน' });
  await expect(mod.locator('.skeleton')).toHaveCount(0);
  for (const o of ['M', '25%']) await press(mod.getByRole('button', { name: new RegExp(`^${o}`) }));
  await press(mod.locator('button.btn-primary'));
  await expect(mod).toHaveCount(0);
  await addPlain(app, press, 'อเมริกาโน่');
  await showCart(app);
  await expect(lines(app)).toHaveCount(2);
  await app.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity));
  expectNoSmallTargets(await smallTargets(app), 'POS with cart', info);

  await press(payButton(app, /^\s*เงินสด\s*$/));
  const pay = app.getByRole('dialog', { name: 'รับเงินสด' });
  await expect(pay).toBeVisible();
  await app.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity));
  expectNoSmallTargets(await smallTargets(app), 'cash payment modal', info);
});
