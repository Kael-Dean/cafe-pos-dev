import { test as base, expect, type Page } from '@playwright/test';
import { MockApi } from './mock-api';

type Fixtures = {
  /** Mock BFF boundary, already installed on `page`. Not signed in yet. */
  api: MockApi;
  /** Signed-in session (flag cookie set) + the POS loaded and showing the menu. */
  pos: Page;
};

export const test = base.extend<Fixtures>({
  api: async ({ page }, provide) => {
    const api = new MockApi();
    await api.install(page);
    await provide(api);
  },

  pos: async ({ page, context, api, baseURL }, provide) => {
    await api.signIn(context, baseURL!);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /ลาเต้ร้อน/ }).first()).toBeVisible();
    await provide(page);
  },
});

export { expect };

/**
 * Types a PIN on the physical keyboard. Waits for the pad to be mounted first (keys sent
 * before hydration are silently lost) and for each digit to register before the next one.
 */
export async function typePin(page: Page, pin: string): Promise<void> {
  await expect(page.locator('[aria-label="แป้น PIN"]')).toBeVisible();
  await expect(page.getByText('ยังไม่ได้ใส่ PIN')).toBeAttached();
  for (let i = 0; i < pin.length; i++) {
    await page.keyboard.press(`Digit${pin[i]}`);
    if (i < pin.length - 1) await expect(page.getByText(`ใส่แล้ว ${i + 1} หลัก`)).toBeAttached();
  }
}
