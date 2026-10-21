import { test as harness, expect, goTo, shot } from './support/handoff-fixtures';
import { installCash, type CashState } from './support/cash-reconciliation-mock';

/**
 * Handoff session-reconciliation/api-handoff.md: close a cash session with per-payment-group
 * actual amounts + notes, see the variance (actual − system) before and after the close, and
 * configure the payment groups (owner / manager settings).
 * Tablet landscape 1280×800 + phone 375; screenshots in docs/qa/remaining-handoffs/.
 */

const test = harness.extend<{ cash: CashState }>({
  // auto: installed before the `app` fixture boots the POS, so no query is cached from the default mock.
  cash: [async ({ api }, provide) => { await provide(installCash(api)); }, { auto: true }],
});

const row = (page: import('@playwright/test').Page, group: string) => page.locator(`.rec-row[data-group="${group}"]`).first();

test('close a session per payment group → variance per row, stored entries shown', async ({ app: page, cash }) => {
  await goTo(page, 'cash');
  await expect(page.getByRole('heading', { name: /กระทบยอดตามช่องทางชำระเงิน/ })).toBeVisible();

  // Rows come from GET /payment-groups (not hard-coded), totals from /summary.
  await expect(row(page, 'Cash')).toContainText('฿4,250');
  await expect(row(page, 'Online')).toContainText('฿12,800.50');
  await expect(row(page, 'Online')).toContainText('พร้อมเพย์ QR');

  // Submitting empty → inline errors, nothing sent.
  await page.getByRole('button', { name: 'ตรวจทานและปิดกะ' }).click();
  await expect(row(page, 'Cash').getByText('กรอกยอดนับจริง')).toBeVisible();
  expect(cash.closeBodies).toHaveLength(0);

  // Counted 150 short on cash; online matches. Live variance, exact satang.
  await page.getByLabel('ยอดนับจริง Cash').fill('4100');
  await expect(row(page, 'Cash').locator('.rec-var')).toContainText('-฿150');
  await expect(row(page, 'Cash')).toHaveAttribute('data-tone', 'short');
  await page.getByLabel('หมายเหตุ Cash').fill('ขาด 150 บาท — นับใหม่พรุ่งนี้');
  await page.getByLabel('ยอดนับจริง Online').fill('12800.5');
  await expect(row(page, 'Online').locator('.rec-var')).toContainText('ตรง');
  await expect(page.locator('.rec-totals')).toContainText('-฿150 ขาด');

  // Validation: > 2 decimals
  await page.getByLabel('ยอดนับจริง Online').fill('12800.555');
  await page.getByLabel('ยอดนับจริง Cash').focus();
  await expect(row(page, 'Online').getByText('ทศนิยมได้ไม่เกิน 2 ตำแหน่ง')).toBeVisible();
  await page.getByLabel('ยอดนับจริง Online').fill('12800.50');
  await shot(page, '10-cash-close-form');

  await page.getByRole('button', { name: 'ตรวจทานและปิดกะ' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('ยืนยันปิดกะ');
  await expect(dlg).toContainText('-฿150');
  await shot(page, '11-cash-close-confirm');
  await dlg.getByRole('button', { name: 'ยืนยันปิดกะ' }).click();

  // Exact payload: one entry per configured group, 2-dp strings, empty note → null, no legacy cash_close.
  await expect.poll(() => cash.closeBodies.length).toBe(1);
  expect(cash.closeBodies[0]).toEqual({
    entries: [
      { group_name: 'Cash', actual_amount: '4100.00', notes: 'ขาด 150 บาท — นับใหม่พรุ่งนี้' },
      { group_name: 'Online', actual_amount: '12800.50', notes: null },
    ],
  });

  // Result from the close response (server variance), session no longer open.
  const done = page.getByRole('status').filter({ hasText: 'ปิดกะแล้ว' });
  await expect(done).toBeVisible();
  await expect(done.locator('.rec-row[data-group="Cash"]')).toContainText('-฿150');
  await expect(done.locator('.rec-row[data-group="Cash"]')).toHaveAttribute('data-tone', 'short');
  await expect(done).toContainText('ขาด 150 บาท — นับใหม่พรุ่งนี้');
  await expect(page.getByText('เปิดกะวันนี้')).toBeVisible();
  await shot(page, '12-cash-closed-result');
});

test('already closed elsewhere → 409 is explained, not a crash', async ({ app: page, cash }) => {
  await goTo(page, 'cash');
  await page.getByLabel('ยอดนับจริง Cash').fill('4250');
  await page.getByLabel('ยอดนับจริง Online').fill('12800.50');
  await page.getByRole('button', { name: 'ตรวจทานและปิดกะ' }).click();
  cash.session.closed_at = '2026-06-07T20:00:00+07:00'; // another manager closed it meanwhile
  await page.getByRole('dialog').getByRole('button', { name: 'ยืนยันปิดกะ' }).click();
  await expect(page.getByText('กะนี้ถูกปิดไปแล้ว')).toBeVisible();
});

test('owner configures payment groups in settings → the close form follows', async ({ app: page, cash }) => {
  await goTo(page, 'settings');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'กลุ่มการชำระเงิน (ปิดกะ)' }) });
  await expect(card.getByLabel('ชื่อกลุ่มที่ 1')).toHaveValue('Cash');

  // Rename + add a group; an empty group blocks Save with an inline reason.
  await card.getByLabel('ชื่อกลุ่มที่ 2').fill('บัตร');
  await card.getByRole('button', { name: 'เพิ่มกลุ่ม' }).click();
  await card.getByLabel('ชื่อกลุ่มที่ 3').fill('QR / Wallet');
  await expect(card.getByText('ยังไม่มีช่องทางชำระเงินในกลุ่มนี้')).toBeVisible();
  await expect(card.getByRole('button', { name: 'บันทึกกลุ่ม' })).toBeDisabled();

  for (const m of ['พร้อมเพย์ QR', 'LINE Pay', 'TrueMoney']) {
    await card.getByRole('button', { name: `กลุ่มของ ${m}` }).click();
    await page.getByRole('option', { name: 'QR / Wallet' }).click();
  }
  await expect(card.getByText('ยังไม่มีช่องทางชำระเงินในกลุ่มนี้')).toHaveCount(0);
  await shot(page, '13-settings-payment-groups');
  await card.getByRole('button', { name: 'บันทึกกลุ่ม' }).click();
  await expect.poll(() => cash.groupBodies.length).toBe(1);
  expect(cash.groupBodies[0]).toEqual([
    { name: 'Cash', methods: ['CASH'] },
    { name: 'บัตร', methods: ['CARD', 'OTHER'] },
    { name: 'QR / Wallet', methods: ['QR_PROMPTPAY', 'LINE_PAY', 'TRUEMONEY'] },
  ]);

  await goTo(page, 'cash');
  await expect(page.locator('.rec-row')).toHaveCount(3);
  await expect(row(page, 'QR / Wallet')).toContainText('฿4,800.50');
  await expect(row(page, 'บัตร')).toContainText('฿8,000');
});

test('barista: no payment-group settings, no close form', async ({ api, app: page }) => {
  api.role = 'BARISTA';
  await page.reload();
  await goTo(page, 'settings');
  await expect(page.getByRole('heading', { name: 'กลุ่มการชำระเงิน (ปิดกะ)' })).toHaveCount(0);
});
