import { test, expect, navTo } from './support/fixtures';
import type { MockApi } from './support/mock-api';

const statusCalls = (api: MockApi) => api.find('PATCH', /\/api\/v1\/orders\/[^/]+\/status$/);

test.describe('KDS bump + undo window (5s, the status is only sent after it)', () => {
  test.beforeEach(async ({ api, context, baseURL }) => {
    api.seedOrder({ status: 'PAID' });
    await api.signIn(context, baseURL!);
  });

  test('undo inside 5s sends NO request, the ticket returns to "new", even after the window passes', async ({ page, api }) => {
    await page.goto('/?screen=kds');
    const start = page.getByRole('button', { name: 'เริ่มทำ' }).first();
    await expect(start).toBeVisible();

    await start.click();
    const snack = page.locator('.ui-snackbar');
    await expect(snack).toContainText('#1');
    await snack.getByRole('button', { name: 'เลิกทำ' }).click();

    // Ticket is back in its original state.
    await expect(page.getByRole('button', { name: 'เริ่มทำ' }).first()).toBeVisible();
    await expect(snack).toHaveCount(0);

    // Wait out the full undo window (+ margin): a cancelled bump must never be sent late.
    await page.waitForTimeout(5_600);
    expect(statusCalls(api)).toHaveLength(0);
    expect(api.orders[0].status).toBe('PAID');
  });

  test('control: without undo the change IS sent once, after the window', async ({ page, api }) => {
    await page.goto('/?screen=kds');
    await page.getByRole('button', { name: 'เริ่มทำ' }).first().click();
    await expect(page.locator('.ui-snackbar')).toBeVisible();

    expect(statusCalls(api)).toHaveLength(0); // not yet: still inside the window
    await expect.poll(() => statusCalls(api).length, { timeout: 8_000 }).toBe(1);
    expect(statusCalls(api)[0].body).toEqual({ status: 'IN_PROGRESS' });
  });

  test('undo, then leaving the screen right away still sends nothing', async ({ page, api }) => {
    await page.goto('/?screen=kds');
    await page.getByRole('button', { name: 'เริ่มทำ' }).first().click();
    await page.locator('.ui-snackbar').getByRole('button', { name: 'เลิกทำ' }).click();
    await navTo(page, 'pos', 'หน้าขาย (POS)');
    await expect(page.getByRole('heading', { name: 'หน้าขาย (POS)' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(statusCalls(api)).toHaveLength(0);
  });

  test('keyboard: U undoes the last bump', async ({ page, api }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, 'hardware keyboard');
    await page.goto('/?screen=kds');
    await page.getByRole('button', { name: 'เริ่มทำ' }).first().click();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('KeyU');
    await expect(page.getByRole('button', { name: 'เริ่มทำ' }).first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(statusCalls(api)).toHaveLength(0);
  });
});
