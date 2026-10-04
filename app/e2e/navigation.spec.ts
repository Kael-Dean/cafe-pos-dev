import { test, expect, navTo, screenParam, typePin } from './support/fixtures';

test.describe('?screen= and the Back button', () => {
  test('navigating pushes ?screen= and Back / Forward walk the screens', async ({ pos }) => {
    await navTo(pos, 'kds', 'ครัว (KDS)');
    await expect.poll(() => screenParam(pos)).toBe('kds');
    await expect(pos.getByRole('heading', { name: /จอครัว/ })).toBeVisible();

    await pos.goBack();
    await expect.poll(() => screenParam(pos)).toBe('pos');
    await expect(pos.getByRole('heading', { name: 'หน้าขาย (POS)' })).toBeVisible();

    await pos.goForward();
    await expect.poll(() => screenParam(pos)).toBe('kds');
    await expect(pos.getByRole('heading', { name: /จอครัว/ })).toBeVisible();
  });

  test('Back closes the open dialog first and stays on the screen', async ({ pos }) => {
    // History: pos -> kds -> pos, then a dialog on top.
    await navTo(pos, 'kds', 'ครัว (KDS)');
    await expect.poll(() => screenParam(pos)).toBe('kds');
    await navTo(pos, 'pos', 'หน้าขาย (POS)');
    await expect.poll(() => screenParam(pos)).toBe('pos');

    await pos.getByRole('button', { name: /ลาเต้ร้อน/ }).first().click();
    const phone = (pos.viewportSize()?.width ?? 0) < 768;
    if (phone) await pos.getByRole('tab', { name: /ตะกร้า/ }).click();
    await pos.getByRole('button', { name: /ยกเลิกบิล/ }).first().click(); // opens the "void bill?" alert dialog
    const dialog = pos.getByRole('alertdialog').or(pos.getByRole('dialog'));
    await expect(dialog.first()).toBeVisible();

    await pos.goBack();
    await expect(dialog).toHaveCount(0);                 // dialog consumed the Back press
    expect(screenParam(pos)).toBe('pos');                // and we did NOT fall back to the KDS
    await expect(pos.getByRole('heading', { name: 'หน้าขาย (POS)' })).toBeVisible();
    await expect(pos.locator('.pos__cart').getByText('ลาเต้ร้อน')).toBeVisible(); // bill untouched

    await pos.goBack(); // now there is no dialog: Back leaves the screen
    await expect.poll(() => screenParam(pos)).toBe('kds');
  });

  test('deep link ?screen=kds opens the KDS directly', async ({ page, context, api, baseURL }) => {
    await api.signIn(context, baseURL!);
    await page.goto('/?screen=kds');
    await expect(page.getByRole('heading', { name: /จอครัว/ })).toBeVisible();
    expect(screenParam(page)).toBe('kds');
  });

  test('deep link survives the login screen', async ({ page, api }) => {
    await page.addInitScript(() => localStorage.setItem('kafe:store-slug', 'e2e-shop'));
    await page.goto('/?screen=kds'); // not signed in yet
    await typePin(page, '123456');
    await expect(page.getByRole('heading', { name: /จอครัว/ })).toBeVisible();
    expect(api.find('POST', '/api/auth/login')).toHaveLength(1);
  });

  test('an unknown ?screen= value falls back to the POS', async ({ page, context, api, baseURL }) => {
    await api.signIn(context, baseURL!);
    await page.goto('/?screen=does-not-exist');
    await expect(page.getByRole('heading', { name: 'หน้าขาย (POS)' })).toBeVisible();
  });

  test('a barista deep-linking to ?screen=hr is bounced to the POS (URL rewritten too)', async ({ page, context, api, baseURL }) => {
    api.role = 'BARISTA';
    await api.signIn(context, baseURL!);
    await page.goto('/?screen=hr');

    await expect(page.getByRole('heading', { name: 'หน้าขาย (POS)' })).toBeVisible();
    await expect.poll(() => screenParam(page)).toBe('pos');
    await expect(page.getByRole('heading', { name: /บุคคล/ })).toHaveCount(0);
    // The HR screen never even fetched its data.
    expect(api.calls.filter((c) => c.path.startsWith('/api/v1/hr/staff'))).toEqual([]);
  });

  test('an owner can open ?screen=hr (control for the barista test)', async ({ page, context, api, baseURL }) => {
    await api.signIn(context, baseURL!);
    api.extra.push(async (c, route) => {
      if (c.path.startsWith('/api/v1/hr/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return true;
      }
      return false;
    });
    await page.goto('/?screen=hr');
    await expect.poll(() => screenParam(page)).toBe('hr');
    await expect(page.getByRole('heading', { name: 'หน้าขาย (POS)' })).toHaveCount(0);
  });
});
