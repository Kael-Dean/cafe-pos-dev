import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { MockApi } from './mock-api';

/**
 * Shared harness for the "remaining handoffs" specs (pre-order calendar, session
 * reconciliation, duplicate product): signed-in app on the mock BFF, run on the landscape
 * tablet (tablet-1024 project resized to 1280×800) and on the phone (mobile-375).
 * Screenshots land in docs/qa/remaining-handoffs/.
 */

export const SHOTS = path.resolve(__dirname, '../../../../docs/qa/remaining-handoffs');
fs.mkdirSync(SHOTS, { recursive: true });

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

export const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(SHOTS, `${name}-${isPhone(page) ? 'phone-375' : 'tablet-1280'}.png`) });

type Fixtures = { api: MockApi; app: Page };

export const test = base.extend<Fixtures>({
  api: async ({ page }, provide) => {
    const api = new MockApi();
    await api.install(page);
    await provide(api);
  },
  app: async ({ page, context, api, baseURL }, provide) => {
    await api.signIn(context, baseURL!);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /ลาเต้ร้อน/ }).first()).toBeVisible();
    await provide(page);
  },
});

test.beforeEach(async ({ page }, info) => {
  test.skip(!['tablet-1024', 'mobile-375'].includes(info.project.name), 'tablet landscape + phone only');
  if (info.project.name === 'tablet-1024') await page.setViewportSize({ width: 1280, height: 800 });
});

export { expect };

const GROUP: Record<string, string> = {
  'pre-orders': 'sec-service', cash: 'sec-service', shifts: 'sec-manage', bom: 'sec-kitchen', settings: 'sec-setup',
};

/** Navigate like a user: sidebar on tablet, bottom tabs or the menu sheet on phones. */
export async function goTo(page: Page, screen: string): Promise<void> {
  if (isPhone(page)) {
    const tab = page.locator(`.tabbar [data-tab-id="${screen}"]`);
    if (await tab.count()) await tab.click();
    else {
      await page.locator('.tabbar [data-tab-id="menu"]').click();
      await page.locator(`.navsheet [data-nav-id="${screen}"]`).click();
    }
  } else {
    const group = page.locator(`#sb-group-${GROUP[screen]}`);
    if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false') await group.click();
    await page.locator(`aside [data-nav-id="${screen}"]`).click();
  }
  await expect(page.locator(`[data-nav-id="${screen}"][aria-current="page"], [data-tab-id="${screen}"][aria-current="page"]`).first()).toBeAttached();
}
