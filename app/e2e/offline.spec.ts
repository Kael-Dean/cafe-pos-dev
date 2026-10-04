import { test, expect } from './support/fixtures';

test.describe('offline: the till is online-only for money, but the bill stays editable', () => {
  test('Charge is disabled WITH a reason, the cart still edits, and Charge recovers when back online', async ({ pos, api, context }) => {
    const phone = (pos.viewportSize()?.width ?? 0) < 768;
    const openCart = async () => { if (phone) await pos.getByRole('tab', { name: /ตะกร้า/ }).click(); };

    // Online: build a bill. Wait for the modifier prefetch so a tap can add without the network.
    await pos.getByRole('button', { name: /ลาเต้ร้อน/ }).first().click();
    await expect.poll(() => api.find('GET', '/api/v1/products/p-americano').length).toBeGreaterThan(0);

    await context.setOffline(true);
    await expect(pos.getByText('ออฟไลน์อยู่')).toBeVisible();

    // Cart is still editable offline: add another product (options were cached) and bump quantity.
    await pos.getByRole('button', { name: /อเมริกาโน่/ }).first().click();
    await openCart();
    const cart = pos.locator('.pos__cart');
    await expect(cart.getByText('อเมริกาโน่')).toBeVisible();
    await cart.getByRole('button', { name: 'เพิ่ม' }).first().click();
    await expect(cart.getByText('฿170').first()).toBeVisible(); // 2*60 + 50

    // Charge: disabled, focusable, and says why (accessible description + tooltip).
    const charge = cart.getByRole('button', { name: /รับเงินสด/ });
    await expect(charge).toHaveAccessibleDescription('ออฟไลน์ — รับเงินไม่ได้');
    await expect(charge).toHaveAttribute('title', 'ออฟไลน์ — รับเงินไม่ได้');
    await charge.click({ force: true });
    await pos.keyboard.press('F12');
    await expect(pos.getByRole('dialog')).toHaveCount(0);
    expect(api.find('POST', '/api/v1/orders')).toHaveLength(0);

    // Back online: the same button works without a reload.
    await context.setOffline(false);
    await expect(pos.getByText('ออฟไลน์อยู่')).toHaveCount(0);
    await expect(charge).not.toHaveAccessibleDescription('ออฟไลน์ — รับเงินไม่ได้');
    await charge.click();
    await expect(pos.getByRole('dialog').getByText('ยอดที่ต้องชำระ')).toBeVisible();
    await expect(pos.getByRole('dialog').getByText('฿170').first()).toBeVisible();
  });

  test('going offline while the payment sheet is open blocks confirming and keeps the bill', async ({ pos, api, context }) => {
    await pos.getByRole('button', { name: /ลาเต้ร้อน/ }).first().click();
    const phone = (pos.viewportSize()?.width ?? 0) < 768;
    if (phone) await pos.getByRole('tab', { name: /ตะกร้า/ }).click();
    await pos.getByRole('button', { name: /รับเงินสด/ }).first().click();
    const dialog = pos.getByRole('dialog');
    await dialog.getByRole('button', { name: /พอดี/ }).click();

    await context.setOffline(true);
    await expect(dialog.getByText('ออฟไลน์ — รับเงินไม่ได้').first()).toBeVisible();
    const confirm = dialog.getByRole('button', { name: /ยืนยันรับเงิน/ });
    await confirm.click({ force: true });
    expect(api.find('POST', '/api/v1/orders')).toHaveLength(0);

    await context.setOffline(false);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(pos.getByRole('button', { name: /ออเดอร์ถัดไป/ })).toBeVisible();
    expect(api.find('POST', '/api/v1/orders')).toHaveLength(1);
  });
});
