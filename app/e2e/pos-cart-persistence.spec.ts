import { test, expect, navTo, screenParam } from './support/fixtures';

const cartLines = (page: import('@playwright/test').Page) => page.locator('.pos__cart');

test.describe('cart survives navigation and reload', () => {
  test('KDS round trip and a page reload keep the open bill (persisted per store)', async ({ pos, api }) => {
    // Build a bill: 2 x latte + 1 croissant.
    await pos.getByRole('button', { name: /ลาเต้ร้อน/ }).first().click();
    await pos.getByRole('button', { name: /ลาเต้ร้อน/ }).first().click();
    await pos.getByRole('button', { name: /ครัวซองต์/ }).first().click();
    const phone = (pos.viewportSize()?.width ?? 0) < 768;
    if (phone) await pos.getByRole('tab', { name: /ตะกร้า/ }).click();
    await expect(cartLines(pos).getByText('ลาเต้ร้อน')).toBeVisible();
    await expect(cartLines(pos).getByText('ครัวซองต์')).toBeVisible();
    await expect(cartLines(pos).getByText('฿165').first()).toBeVisible(); // 2*60 + 45

    // Away to the kitchen screen: POS unmounts (screens remount with key={screen}).
    await navTo(pos, 'kds', 'ครัว (KDS)');
    await expect.poll(() => screenParam(pos)).toBe('kds');
    await expect(cartLines(pos)).toHaveCount(0);

    // Back: the very same bill is there.
    await navTo(pos, 'pos', 'หน้าขาย (POS)');
    await expect.poll(() => screenParam(pos)).toBe('pos');
    if (phone) await pos.getByRole('tab', { name: /ตะกร้า/ }).click();
    await expect(cartLines(pos).getByText('ลาเต้ร้อน')).toBeVisible();
    await expect(cartLines(pos).getByText('฿165').first()).toBeVisible();

    // Hard reload: still there, and it is stored under THIS store's id.
    await pos.reload();
    if (phone) await pos.getByRole('tab', { name: /ตะกร้า/ }).click();
    await expect(cartLines(pos).getByText('ลาเต้ร้อน')).toBeVisible();
    await expect(cartLines(pos).getByText('ครัวซองต์')).toBeVisible();
    await expect(cartLines(pos).getByText('฿165').first()).toBeVisible();

    const persisted = await pos.evaluate(() => JSON.parse(localStorage.getItem('pos-cart-v1') ?? 'null'));
    expect(persisted.state.scope).toBe('store-e2e-1');
    expect(persisted.state.byScope['store-e2e-1'].bill.lines).toHaveLength(2);

    // Nothing was ordered just by navigating.
    expect(api.find('POST', '/api/v1/orders')).toHaveLength(0);
  });

  test('another branch on the same device does not see this open bill', async ({ pos, page }) => {
    await pos.getByRole('button', { name: /ลาเต้ร้อน/ }).first().click();
    await expect.poll(() => pos.evaluate(() => localStorage.getItem('pos-cart-v1') ?? '')).toContain('p-latte');

    // Same browser storage, but /auth/me now says a different store.
    await page.route('**/api/v1/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'u9', name: 'อีกสาขา', role: 'OWNER', store_id: 'store-other', store_name: 'อีกสาขา', tenant_id: 't' }),
      }));
    await pos.reload();
    await expect(pos.getByRole('button', { name: /ลาเต้ร้อน/ }).first()).toBeVisible();
    const phone = (pos.viewportSize()?.width ?? 0) < 768;
    if (phone) await pos.getByRole('tab', { name: /ตะกร้า/ }).click();
    await expect(cartLines(pos).getByText('ยังไม่มีรายการ')).toBeVisible();
  });
});
