import { test as base, expect, type Locator, type Page } from '@playwright/test';
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

/** Sidebar entry on tablet/desktop, bottom tab bar on phones. */
export async function navTo(page: Page, id: 'pos' | 'kds' | 'floor', label: string): Promise<void> {
  const side: Locator = page.locator(`[data-nav-id="${id}"]`);
  if (await side.isVisible()) {
    await side.click();
    return;
  }
  void label; // (kept for readable call sites; phones use the stable tab id)
  await page.locator(`[data-tab-id="${id}"]`).click();
}

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1024) < 768;

/** Current `?screen=` value ('pos' when absent). */
export const screenParam = (page: Page) => new URL(page.url()).searchParams.get('screen') ?? 'pos';

export const baht = (n: number) => `฿${n.toLocaleString('en-US')}`;

/**
 * Drives the "/" shortcut. Desktop POS auto-focuses the search box on mount, and the
 * typing guard (by design) lets "/" through as a literal character while a field has
 * focus, so blur first to exercise the shortcut itself.
 */
export async function focusSearchWithSlash(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Slash');
  await expect(page.getByPlaceholder('ค้นหาเมนู')).toBeFocused();
  await expect(page.getByPlaceholder('ค้นหาเมนู')).toHaveValue('');
}

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
