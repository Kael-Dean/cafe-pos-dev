import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';

async function openCashSheetWithLatte(pos: Page) {
  await pos.getByRole('button', { name: /ลาเต้ร้อน/ }).first().click();
  if ((pos.viewportSize()?.width ?? 0) < 768) await pos.getByRole('tab', { name: /ตะกร้า/ }).click();
  await pos.getByRole('button', { name: /รับเงินสด/ }).first().click();
  const dialog = pos.getByRole('dialog');
  await dialog.getByRole('button', { name: /พอดี/ }).click();
  return dialog;
}

test.describe('payment failure never duplicates the order', () => {
  test('pay fails -> inline error, bill intact; retry pays the SAME order (1 create, 2 pay attempts)', async ({ pos, api }) => {
    api.failPay = 1;
    const dialog = await openCashSheetWithLatte(pos);
    await dialog.getByRole('button', { name: /ยืนยันรับเงิน/ }).click();

    // Inline error inside the sheet; the sheet stays open and offers a retry.
    await expect(dialog.getByText('บันทึกการชำระเงินไม่สำเร็จ')).toBeVisible();
    await expect(dialog.getByText(/ระบบชำระเงินขัดข้อง/)).toBeVisible();
    const retry = dialog.getByRole('button', { name: /ลองอีกครั้ง/ });
    await expect(retry).toBeEnabled();
    expect(api.find('POST', '/api/v1/orders')).toHaveLength(1);

    // The bill is untouched behind the sheet (persisted cart still has the line).
    const persisted = await pos.evaluate(() => localStorage.getItem('pos-cart-v1') ?? '');
    expect(persisted).toContain('p-latte');

    await retry.click();
    await expect(pos.getByRole('button', { name: /ออเดอร์ถัดไป/ })).toBeVisible();

    // One order, two payment attempts against the same order id.
    const creates = api.find('POST', '/api/v1/orders');
    const pays = api.find('PATCH', /\/api\/v1\/orders\/[^/]+\/pay$/);
    expect(creates).toHaveLength(1);
    expect(pays).toHaveLength(2);
    expect(pays[0].path).toBe(pays[1].path);
    expect(api.orders).toHaveLength(1);
    expect(api.orders[0].status).toBe('PAID');
  });

  test('create fails -> retry re-sends the SAME idempotency key (server can de-duplicate)', async ({ pos, api }) => {
    api.failCreate = 1;
    const dialog = await openCashSheetWithLatte(pos);
    await dialog.getByRole('button', { name: /ยืนยันรับเงิน/ }).click();
    await expect(dialog.getByText('บันทึกการชำระเงินไม่สำเร็จ')).toBeVisible();
    expect(api.orders).toHaveLength(0);

    await dialog.getByRole('button', { name: /ลองอีกครั้ง/ }).click();
    await expect(pos.getByRole('button', { name: /ออเดอร์ถัดไป/ })).toBeVisible();

    const creates = api.find('POST', '/api/v1/orders');
    expect(creates).toHaveLength(2);
    const keys = creates.map((c) => (c.body as { idempotency_key: string }).idempotency_key);
    expect(keys[0]).toBe(keys[1]);
    expect(api.orders).toHaveLength(1);
  });

  test('cancelling the sheet after a failed payment clears the bill (the order already exists) and tells the cashier', async ({ pos, api }) => {
    api.failPay = 5; // never succeeds
    const dialog = await openCashSheetWithLatte(pos);
    await dialog.getByRole('button', { name: /ยืนยันรับเงิน/ }).click();
    await expect(dialog.getByText('บันทึกการชำระเงินไม่สำเร็จ')).toBeVisible();

    await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(pos.getByRole('dialog')).toHaveCount(0);
    // The order is already in the kitchen, so the bill is cleared rather than re-chargeable as a NEW order.
    await expect.poll(() => pos.evaluate(() => localStorage.getItem('pos-cart-v1') ?? '')).not.toContain('p-latte');
    expect(api.find('POST', '/api/v1/orders')).toHaveLength(1);
    expect(api.orders[0].status).toBe('PENDING');
  });
});
