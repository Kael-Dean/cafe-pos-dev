import { test, expect, typePin } from './support/fixtures';

test.describe('login with the PIN pad', () => {
  test('store id + 6-digit PIN lands on the POS', async ({ page, api }) => {
    await page.goto('/');

    // First visit on a device: ask for the Store ID once.
    await page.getByLabel('Store ID').fill('e2e-shop');
    await page.getByRole('button', { name: 'ถัดไป' }).click();
    await expect(page.getByText('สาขา e2e-shop')).toBeVisible();

    // Tap the on-screen pad (not the keyboard): the touch path is what tablets use.
    const pad = page.getByRole('group', { name: 'แป้น PIN' }).or(page.locator('[aria-label="แป้น PIN"]'));
    for (const d of '123456') await pad.getByRole('button', { name: d, exact: true }).click();

    await expect(page.getByRole('button', { name: /ลาเต้ร้อน/ }).first()).toBeVisible();
    const login = api.find('POST', '/api/auth/login');
    expect(login).toHaveLength(1);
    expect(login[0].body).toEqual({ store_slug: 'e2e-shop', pin: '123456' });

    // The Store ID is remembered; the PIN is not stored anywhere.
    expect(await page.evaluate(() => localStorage.getItem('kafe:store-slug'))).toBe('e2e-shop');
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('123456');
  });

  test('a wrong PIN shows the error, clears the dots and stays on the login screen', async ({ page, api }) => {
    await page.addInitScript(() => localStorage.setItem('kafe:store-slug', 'e2e-shop'));
    await page.goto('/');

    // Keyboard entry works too (matched on e.code, so it also works with the Thai layout).
    await typePin(page, '999999');

    await expect(page.getByText('PIN หรือ Store ID ไม่ถูกต้อง')).toBeVisible();
    await expect(page.getByRole('button', { name: /ลาเต้ร้อน/ })).toHaveCount(0);
    expect(api.find('POST', '/api/auth/login')).toHaveLength(1);

    // …and the right PIN afterwards still works.
    await typePin(page, '123456');
    await expect(page.getByRole('button', { name: /ลาเต้ร้อน/ }).first()).toBeVisible();
  });

  test('logging out returns to the login screen and calls the BFF logout', async ({ pos, api }) => {
    await pos.evaluate(() => localStorage.setItem('kafe:store-slug', 'e2e-shop')); // device already knows its store
    const phone = (pos.viewportSize()?.width ?? 0) < 768;
    if (phone) {
      await pos.getByRole('button', { name: /เมนู/ }).last().click();
      await pos.locator('[data-action="logout"]').click();
    } else {
      // Tablet tier (768–1279) opens on the labelled rail; logout lives in the expanded
      // panel, one tap away (TOUCH-SPEC §3.1). The POS tier opens expanded.
      if ((pos.viewportSize()?.width ?? 0) < 1280) await pos.getByRole('button', { name: 'ขยายเมนู' }).click();
      await pos.getByRole('button', { name: /ออกจากระบบ/ }).first().click();
    }
    await expect(pos.getByRole('group', { name: 'แป้น PIN' }).or(pos.locator('[aria-label="แป้น PIN"]'))).toBeVisible();
    expect(api.find('POST', '/api/auth/logout').length).toBeGreaterThanOrEqual(1);
  });
});
