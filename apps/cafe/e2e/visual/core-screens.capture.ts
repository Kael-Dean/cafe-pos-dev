import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { MockApi } from '../support/mock-api';
import { FIXED_NOW, MEMBER_PHONE, seedCaptureApi } from '../support/seed';
import { MIN_TARGET, collectTargets } from '../support/targets';

/**
 * Visual capture of the core touch flow — baseline before the touch-first upgrade and the
 * same states again after it. Run with `npm run capture:screens` (playwright.capture.config.ts).
 *
 * For every viewport (project) × state it writes into CAPTURE_OUT:
 *   <viewport>__<state>.png                 full-viewport screenshot
 *   <viewport>__<state>.small-targets.json  every visible, reachable interactive element whose
 *                                           bounding box is < 44px wide or tall
 *
 * Not a regression test: there are no pixel assertions. The `expect`s only make sure the
 * state was really reached (and settled) before the shutter fires.
 */

const OUT = process.env.CAPTURE_OUT || 'D:\\POS-dev\\docs\\touch-upgrade\\baseline';

/**
 * Applied only while the shutter fires. Hides transient / dev-only chrome, and drops the
 * one-shot entrance classes: their end state is identical (opacity 1, no transform), but
 * whether they ran at all is timing-dependent (e.g. KDS gives cards .rise-in when the orders
 * query lands after first paint) and a finished fill-mode animation keeps the element on a
 * compositor layer, which changes text anti-aliasing from run to run.
 */
const CAPTURE_CSS = `
  .toast-stack { visibility: hidden !important; }
  nextjs-portal { display: none !important; }
  .rise-in, .fade-in { animation: none !important; }
`;

// ── fixtures ─────────────────────────────────────────────────────────────────
type Fixtures = {
  /** Mock BFF with the capture catalogue / floor / KDS seed, clock pinned. Not signed in. */
  api: MockApi;
  /** Signed in, POS loaded and settled. */
  app: Page;
};

const test = base.extend<Fixtures>({
  api: async ({ page }, provide) => {
    const api = new MockApi();
    seedCaptureApi(api);
    await api.install(page);
    // Pin Date (timers keep running) so ticket ages, "opened at" times and the receipt date
    // are identical on every run.
    await page.clock.setFixedTime(FIXED_NOW);
    // Never let the printer bridge (http://127.0.0.1:8080) leak a real request.
    await page.route(/^http:\/\/127\.0\.0\.1:8080\//, (r) => r.abort());
    await provide(api);
  },

  app: async ({ page, context, api, baseURL }, provide) => {
    await page.addInitScript(() => localStorage.setItem('kafe:store-slug', 'e2e-shop'));
    await api.signIn(context, baseURL!);
    await page.goto('/');
    await expect(menuCard(page, 'ลาเต้ร้อน')).toBeVisible();
    if (isPhone(page)) await expect(page.locator('.tabbar .tabbar-tab')).toHaveCount(5); // role resolved
    await settle(page);
    await provide(page);
  },
});

// ── helpers ──────────────────────────────────────────────────────────────────
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1024) < 768;
const visible = (l: Locator) => l.filter({ visible: true }).first();
const menuCard = (page: Page, name: string) => visible(page.locator('button.menu-card').filter({ hasText: name }));
const payButton = (page: Page, name: RegExp) => visible(page.getByRole('button', { name }));

/** Wait until the screen is quiet: no requests, no skeletons, no busy regions, fonts loaded. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('.screen-switching')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    // Entrance animations (screen fade, modal pop-in) still run under reduced motion — only
    // shortened. Measuring mid-animation reads opacity 0 / a scaled box, so wait for every
    // finite animation to end (infinite ones — spinners — are skipped). Two rounds: a
    // finishing animation can start a follow-up one.
    for (let round = 0; round < 2; round++) {
      await frame();
      const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
      await Promise.race([
        Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
    await frame();
    await frame();
  });
}

const SCREEN_GROUP: Record<string, string> = { pos: 'sec-service', kds: 'sec-service', floor: 'sec-boardgame' };

/** Navigate like a user: sidebar on tablet/desktop, bottom tabs or the menu sheet on phones. */
async function goTo(page: Page, screen: string): Promise<void> {
  if (isPhone(page)) {
    const tab = page.locator(`.tabbar [data-tab-id="${screen}"]`);
    if (await tab.count()) {
      await tab.click();
    } else {
      await page.locator('.tabbar [data-tab-id="menu"]').click();
      await page.locator(`.navsheet [data-nav-id="${screen}"]`).click();
    }
  } else {
    // Expanded panel (≥1280 default): open the group first. Tablet rail: every item is visible.
    const group = page.locator(`#sb-group-${SCREEN_GROUP[screen]}`);
    if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false') await group.click();
    await page.locator(`aside [data-nav-id="${screen}"]`).click();
  }
  await expect(page.locator(`[data-nav-id="${screen}"][aria-current="page"], [data-tab-id="${screen}"][aria-current="page"]`).first()).toBeAttached();
}

async function showCartPanel(page: Page): Promise<void> {
  if (isPhone(page)) await page.getByRole('tab', { name: /ตะกร้า/ }).click();
}

/** Add a product that opens the modifier modal, pick options, confirm. */
async function addWithModifiers(page: Page, product: string, options: string[]): Promise<void> {
  await menuCard(page, product).click();
  const dialog = page.getByRole('dialog', { name: `ปรับแต่ง ${product}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.skeleton')).toHaveCount(0);
  for (const o of options) await dialog.getByRole('button', { name: new RegExp(`^${o}`) }).click();
  await dialog.locator('button.btn-primary').click();
  await expect(dialog).toHaveCount(0);
}

/** 4 lines: two with modifiers, one plain, one plain ×2. Total ฿290. */
async function fillCart(page: Page): Promise<void> {
  const lines = page.locator('.pos-line');
  await addWithModifiers(page, 'ลาเต้ร้อน', ['L', '50%']);
  await expect(lines).toHaveCount(1);
  await menuCard(page, 'ครัวซองต์').click();
  await expect(lines).toHaveCount(2);
  await addWithModifiers(page, 'ชาไทยเย็น', ['ไข่มุก']);
  await expect(lines).toHaveCount(3);
  await menuCard(page, 'อเมริกาโน่').click();
  await expect(lines).toHaveCount(4);
  await menuCard(page, 'อเมริกาโน่').click();
  await expect(lines.filter({ hasText: 'อเมริกาโน่' })).toContainText('฿100');
  await settle(page);
}

async function openCashPayment(page: Page): Promise<Locator> {
  await fillCart(page);
  await showCartPanel(page);
  await payButton(page, /^\s*เงินสด\s*$/).click();
  const dialog = page.getByRole('dialog', { name: 'รับเงินสด' });
  await expect(dialog).toBeVisible();
  return dialog;
}

// ── capture + touch-target metric (collector: ../support/targets.ts) ──────────
async function capture(page: Page, info: TestInfo, state: string, api?: MockApi): Promise<void> {
  await settle(page);
  const viewport = info.project.name;
  const base = path.join(OUT, `${viewport}__${state}`);
  fs.mkdirSync(OUT, { recursive: true });

  const { total, obscured, items } = await page.evaluate(collectTargets, MIN_TARGET);
  const effective = items.filter((i) => i.hitWidth < MIN_TARGET || i.hitHeight < MIN_TARGET);
  const report = {
    viewport,
    state,
    size: page.viewportSize(),
    threshold: MIN_TARGET,
    capturedAt: FIXED_NOW.toISOString(),
    counts: {
      /** visible + reachable interactive elements */
      targets: total,
      /** of those, bounding box < 44px in width or height — THE metric */
      small: items.length,
      /** still < 44px after counting a .hit-44 style pseudo-element tap area */
      smallEffective: effective.length,
      /** visible but covered (e.g. behind a modal backdrop) — not counted */
      obscured,
    },
    items,
    unmockedApi: api ? [...new Set(api.unhandled)] : [],
  };
  fs.writeFileSync(`${base}.small-targets.json`, JSON.stringify(report, null, 2) + '\n');

  await page.screenshot({ path: `${base}.png`, animations: 'disabled', caret: 'hide', style: CAPTURE_CSS });
}

// ── states ───────────────────────────────────────────────────────────────────
test.describe('login', () => {
  test('login-store', async ({ page, api }, info) => {
    await page.goto('/');
    await expect(page.getByLabel('Store ID')).toBeVisible();
    await capture(page, info, 'login-store', api);
  });

  test('login-pin', async ({ page, api }, info) => {
    await page.addInitScript(() => localStorage.setItem('kafe:store-slug', 'e2e-shop'));
    await page.goto('/');
    await expect(page.locator('[aria-label="แป้น PIN"]')).toBeVisible();
    await expect(page.getByText('ยังไม่ได้ใส่ PIN')).toBeAttached();
    await capture(page, info, 'login-pin', api);
  });
});

test.describe('pos', () => {
  test('pos-empty', async ({ app, api }, info) => {
    await capture(app, info, 'pos-empty', api);
  });

  test('pos-cart', async ({ app, api }, info) => {
    await fillCart(app);
    if (isPhone(app)) {
      // Phones: the menu with the running-total cart bar, then the cart tab itself.
      await expect(app.locator('.pos-cartbar')).toBeVisible();
      await capture(app, info, 'pos-cart-menubar', api);
      await showCartPanel(app);
    }
    await expect(visible(app.locator('.pos-line'))).toBeVisible();
    await capture(app, info, 'pos-cart', api);
  });

  test('pos-cart-member', async ({ app, api }, info) => {
    await fillCart(app);
    await showCartPanel(app);
    await visible(app.locator('button.pos-head-btn').filter({ hasText: /^\s*สมาชิก\s*$/ })).click();
    const dialog = app.getByRole('dialog', { name: 'สมาชิก / สะสมแต้ม' });
    // Phone entry is an on-screen keypad (NumpadField), not an <input>.
    const phonePad = dialog.getByRole('group', { name: 'เบอร์โทรศัพท์', exact: true });
    for (const k of MEMBER_PHONE) await phonePad.getByRole('button', { name: k, exact: true }).click();
    await dialog.getByRole('button', { name: 'แนบสมาชิกกับบิล' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(visible(app.locator('.pos-member-chip'))).toContainText('น้องเมย์'); // salesperson resolved
    await capture(app, info, 'pos-cart-member', api);
  });

  test('modifier-modal', async ({ app, api }, info) => {
    await menuCard(app, 'ลาเต้ร้อน').click();
    const dialog = app.getByRole('dialog', { name: 'ปรับแต่ง ลาเต้ร้อน' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^เพิ่มช็อต/ })).toBeVisible();
    await capture(app, info, 'modifier-modal', api);
  });
});

test.describe('payment', () => {
  test('payment-cash', async ({ app, api }, info) => {
    const dialog = await openCashPayment(app);
    await capture(app, info, 'payment-cash-empty', api);
    const keys = dialog.getByRole('group', { name: 'แป้นตัวเลข' });
    for (const k of '500') await keys.getByRole('button', { name: k, exact: true }).click();
    await expect(dialog.getByRole('button', { name: /ยืนยันรับเงิน/ })).toBeEnabled();
    await capture(app, info, 'payment-cash', api);
  });

  test('payment-qr', async ({ app, api }, info) => {
    await fillCart(app);
    await showCartPanel(app);
    await payButton(app, /^\s*QR PromptPay\s*$/).click();
    const dialog = app.getByRole('dialog', { name: 'QR PromptPay' });
    await expect(dialog.getByText('รอลูกค้าสแกนจ่าย')).toBeVisible();
    await capture(app, info, 'payment-qr', api);
  });

  test('payment-card', async ({ app, api }, info) => {
    await fillCart(app);
    await showCartPanel(app);
    await payButton(app, /^\s*บัตร\s*$/).click();
    await expect(app.getByRole('dialog', { name: 'รับชำระด้วยบัตร' })).toBeVisible();
    await capture(app, info, 'payment-card', api);
  });

  test('receipt-modal', async ({ app, api }, info) => {
    const dialog = await openCashPayment(app);
    const keys = dialog.getByRole('group', { name: 'แป้นตัวเลข' });
    for (const k of '500') await keys.getByRole('button', { name: k, exact: true }).click();
    await dialog.getByRole('button', { name: /ยืนยันรับเงิน/ }).click();
    const receipt = app.getByRole('dialog', { name: 'ใบเสร็จรับเงิน' });
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('ลาเต้ร้อน');
    expect(api.find('PATCH', /\/pay$/)).toHaveLength(1);
    await capture(app, info, 'receipt-modal', api);
  });
});

test.describe('membership', () => {
  test('membership-modal', async ({ app, api }, info) => {
    await fillCart(app);
    await showCartPanel(app);
    await visible(app.locator('button.pos-head-btn').filter({ hasText: /^\s*สมาชิก\s*$/ })).click();
    const dialog = app.getByRole('dialog', { name: 'สมาชิก / สะสมแต้ม' });
    await expect(dialog).toBeVisible();
    await capture(app, info, 'membership-lookup', api);
    // Phone entry is an on-screen keypad (NumpadField), not an <input>.
    const phonePad = dialog.getByRole('group', { name: 'เบอร์โทรศัพท์', exact: true });
    for (const k of MEMBER_PHONE) await phonePad.getByRole('button', { name: k, exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'แนบสมาชิกกับบิล' })).toBeVisible();
    await capture(app, info, 'membership-found', api);
  });
});

test.describe('floor', () => {
  test('floor', async ({ app, api }, info) => {
    await goTo(app, 'floor');
    await expect(app.getByRole('button', { name: 'โต๊ะ A1 ว่าง' })).toBeVisible();
    await expect(app.getByRole('button', { name: /^โต๊ะ B3 กำลังใช้/ })).toContainText('1,200');
    await capture(app, info, 'floor', api);
  });

  test('table-session-modal', async ({ app, api }, info) => {
    await goTo(app, 'floor');
    await app.getByRole('button', { name: 'โต๊ะ A1 ว่าง' }).click();
    const open = app.getByRole('dialog', { name: /เปิดโต๊ะ A1/ });
    await expect(open).toBeVisible();
    await capture(app, info, 'table-session-open', api);
    await open.getByRole('button', { name: 'ปิด' }).first().click();
    await expect(open).toHaveCount(0);

    await app.getByRole('button', { name: /^โต๊ะ A2 กำลังใช้/ }).click();
    const detail = app.getByRole('dialog', { name: /โต๊ะ A2/ });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('button', { name: /สั่งอาหาร/ })).toBeVisible();
    await capture(app, info, 'table-session-detail', api);
  });
});

test.describe('kds', () => {
  test('kds', async ({ app, api }, info) => {
    await goTo(app, 'kds');
    await expect(app.getByText('สปาเก็ตตี้คาโบนาร่า')).toBeVisible();
    await capture(app, info, 'kds', api);
  });
});

test.describe('navigation', () => {
  test('sidebar', async ({ app, api }, info) => {
    test.skip(isPhone(app), 'phones have no sidebar (MobileNav instead)');
    const aside = app.locator('aside.sidebar-surface');
    const expandPanel = async () => {
      const board = app.locator('#sb-group-sec-boardgame');
      if ((await board.getAttribute('aria-expanded')) === 'false') await board.click();
      await expect(app.locator('aside [data-nav-id="floor"]')).toBeVisible();
    };
    // Tablet tier (<1280) opens on the labelled rail and expands as an overlay;
    // the POS tier opens expanded and collapses to the rail.
    if ((app.viewportSize()?.width ?? 0) < 1280) {
      await expect.poll(async () => (await aside.boundingBox())?.width).toBe(80);
      await capture(app, info, 'sidebar-collapsed', api);
      await app.getByRole('button', { name: 'ขยายเมนู' }).click();
      await expect(app.getByRole('button', { name: 'ย่อเมนู' })).toBeVisible();
      await expandPanel();
      await capture(app, info, 'sidebar-expanded', api);
    } else {
      await expandPanel();
      await capture(app, info, 'sidebar-expanded', api);
      await app.getByRole('button', { name: 'ย่อเมนู' }).click();
      await expect(app.getByRole('button', { name: 'ขยายเมนู' })).toBeVisible();
      await expect.poll(async () => (await aside.boundingBox())?.width).toBe(80);
      await capture(app, info, 'sidebar-collapsed', api);
    }
  });

  test('mobile-nav-sheet', async ({ app, api }, info) => {
    test.skip(!isPhone(app), 'the bottom tab bar + menu sheet exist on phones only');
    await app.locator('.tabbar [data-tab-id="menu"]').click();
    const sheet = app.getByRole('dialog', { name: 'เมนูทั้งหมด' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-action="logout"]')).toBeAttached();
    await capture(app, info, 'mobile-nav-sheet', api);
  });
});
