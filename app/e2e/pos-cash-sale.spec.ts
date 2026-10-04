import { test, expect, focusSearchWithSlash } from './support/fixtures';

// The keyboard-only cashier path: no mouse, no touch. Keys are sent by physical
// key (`code`), the way a Thai-layout keyboard reports them.
test.describe('keyboard cash sale', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'hardware-keyboard flow; phones use the touch path');

  test('/ search, Enter, F12, =, Enter, Enter -> receipt -> next order -> empty cart', async ({ pos, api }) => {
    await focusSearchWithSlash(pos);
    await pos.keyboard.type('ลาเต้');

    // One match: Enter adds it and clears the search.
    await pos.keyboard.press('Enter');
    const cart = pos.locator('.pos__cart');
    await expect(cart.getByText('ลาเต้ร้อน')).toBeVisible();
    await expect(cart.getByText('฿60').first()).toBeVisible();

    // F12 opens the cash sheet; "=" fills the exact amount; Enter confirms.
    await pos.keyboard.press('F12');
    const dialog = pos.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('ยอดที่ต้องชำระ')).toBeVisible();
    await pos.keyboard.press('Equal');
    await expect(dialog.getByRole('textbox', { name: 'เงินที่รับมา' })).toContainText('฿60');
    await pos.keyboard.press('Enter');

    // Receipt replaces the payment sheet.
    const receipt = pos.getByRole('dialog').filter({ has: pos.getByRole('button', { name: /ออเดอร์ถัดไป/ }) });
    await expect(receipt).toBeVisible();

    // Exactly one order was created and paid, with cash, for the right product.
    const created = api.find('POST', '/api/v1/orders');
    expect(created).toHaveLength(1);
    const body = created[0].body as { idempotency_key: string; items: { product_id: string; quantity: number }[] };
    expect(body.items).toEqual([{ product_id: 'p-latte', quantity: 1, modifier_ids: [] }]);
    expect(body.idempotency_key).toBeTruthy();
    const paid = api.find('PATCH', /\/api\/v1\/orders\/[^/]+\/pay$/);
    expect(paid).toHaveLength(1);
    expect(paid[0].body).toMatchObject({ payment_method: 'CASH' });

    // The cart was cleared by the payment itself, before anyone clicks "next order".
    await expect(cart.getByText('ลาเต้ร้อน')).toHaveCount(0);

    // Enter on the receipt = next order.
    await pos.keyboard.press('Enter');
    await expect(receipt).toHaveCount(0);
    await expect(cart.getByText('ยังไม่มีรายการ')).toBeVisible();
    expect(api.unhandled).toEqual([]);
  });

  test('"ออเดอร์ถัดไป" button also closes the receipt and focus returns to search', async ({ pos }) => {
    await focusSearchWithSlash(pos);
    await pos.keyboard.type('อเมริกาโน่');
    await pos.keyboard.press('Enter');
    await expect(pos.locator('.pos__cart').getByText('อเมริกาโน่')).toBeVisible();
    await pos.keyboard.press('F12');
    await expect(pos.getByRole('dialog').getByText('ยอดที่ต้องชำระ')).toBeVisible();
    await pos.keyboard.press('Equal');
    await expect(pos.getByRole('dialog').getByRole('textbox', { name: 'เงินที่รับมา' })).toContainText('฿50');
    await pos.keyboard.press('Enter');

    await pos.getByRole('button', { name: /ออเดอร์ถัดไป/ }).click();
    await expect(pos.getByRole('dialog')).toHaveCount(0);
    await expect(pos.locator('.pos__cart').getByText('ยังไม่มีรายการ')).toBeVisible();
    await expect(pos.getByPlaceholder('ค้นหาเมนู')).toBeFocused();
  });

  test('cash short of the total cannot be confirmed (no order is paid)', async ({ pos, api }) => {
    await focusSearchWithSlash(pos);
    await pos.keyboard.type('ลาเต้');
    await pos.keyboard.press('Enter');
    await expect(pos.locator('.pos__cart').getByText('ลาเต้ร้อน')).toBeVisible();
    await pos.keyboard.press('F12');
    await expect(pos.getByRole('dialog').getByText('ยอดที่ต้องชำระ')).toBeVisible();

    // Tender 20 on a 60 bill, then Enter.
    await pos.keyboard.press('Digit2');
    await pos.keyboard.press('Digit0');
    await expect(pos.getByRole('dialog').getByText('ขาดอีก', { exact: true })).toBeVisible();
    await pos.keyboard.press('Enter');

    await expect(pos.getByRole('dialog').getByRole('button', { name: /ยืนยันรับเงิน/ })).toHaveAccessibleDescription(/ยังขาดอีก ฿40/);
    expect(api.find('POST', '/api/v1/orders')).toHaveLength(0);
    expect(api.find('PATCH', /\/pay$/)).toHaveLength(0);
  });
});

test.describe('touch cash sale (all viewports)', () => {
  test('tap product -> charge -> exact -> confirm -> receipt -> next order', async ({ pos, api }) => {
    await pos.getByRole('button', { name: /ครัวซองต์/ }).first().click();
    const phone = (pos.viewportSize()?.width ?? 0) < 768;
    if (phone) await pos.getByRole('tab', { name: /ตะกร้า/ }).click();

    await pos.getByRole('button', { name: /รับเงินสด/ }).first().click();
    const dialog = pos.getByRole('dialog');
    await dialog.getByRole('button', { name: /พอดี/ }).click();
    await dialog.getByRole('button', { name: /ยืนยันรับเงิน/ }).click();

    await pos.getByRole('button', { name: /ออเดอร์ถัดไป/ }).click();
    expect(api.find('POST', '/api/v1/orders')).toHaveLength(1);
    expect(api.find('PATCH', /\/pay$/)).toHaveLength(1);
  });
});
