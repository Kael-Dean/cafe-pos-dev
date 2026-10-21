import { test as harness, expect, goTo, isPhone, shot } from './support/handoff-fixtures';
import { installDuplicate, type DuplicateState } from './support/duplicate-product-mock';

/**
 * Handoff duplicate-product/api-handoff.md: "คัดลอก" on the recipe screen is one
 * POST /api/v1/products/{id}/duplicate (no client-side re-creation), the copy opens with
 * its name ready to edit, lists refresh, and the action is MANAGER / OWNER only.
 * Tablet landscape 1280×800 + phone 375; screenshots in docs/qa/remaining-handoffs/.
 */

const test = harness.extend<{ dup: DuplicateState }>({
  // auto: installed before the `app` fixture boots the POS, so no query is cached from the default mock.
  dup: [async ({ api }, provide) => { await provide(installDuplicate(api)); }, { auto: true }],
});

test('duplicate via the backend endpoint → copy opens with its name ready to edit', async ({ app: page, dup }) => {
  await goTo(page, 'bom');
  await page.getByRole('button', { name: 'คัดลอก ลาเต้ร้อน' }).click();

  await expect.poll(() => dup.duplicateCalls).toEqual(['p-latte']);
  const name = page.getByRole('textbox', { name: 'ชื่อเมนู' });
  await expect(name).toBeVisible();
  await expect(name).toHaveValue('Copy of ลาเต้ร้อน');
  await expect(name).toBeFocused();
  // Recipe + modifier groups came back on the 201 body (seeded into the editor cache).
  await expect(page.getByText('เมล็ดกาแฟคั่วเข้ม').first()).toBeVisible();
  await expect(page.getByText('ชนิดนม').first()).toBeVisible();
  await shot(page, '20-duplicate-rename');

  // Rename right away, then the list shows the new copy (products invalidated).
  await name.fill('ลาเต้เย็น');
  await name.press('Escape');
  if (!isPhone(page)) await expect(page.locator('.bom-list-row', { hasText: 'Copy of ลาเต้ร้อน' })).toBeVisible();

  // The old client-side copy (create + PUT recipe/groups/steps) is gone.
  expect(dup.legacyWrites).toEqual([]);
});

test('long source name → copy name capped at 120 chars; 404 is explained', async ({ app: page, dup }) => {
  const long = dup.products.find((p) => p.id === 'p-long')!;
  await goTo(page, 'bom');
  await page.locator('.bom-list-row', { hasText: 'ครัวซองต์' }).getByRole('button', { name: /^คัดลอก/ }).click();
  const name = page.getByRole('textbox', { name: 'ชื่อเมนู' });
  await expect(name).toHaveValue(`Copy of ${long.name}`.slice(0, 120));
  expect((await name.inputValue()).length).toBe(120);
  await name.press('Escape');
  await shot(page, '21-duplicate-long-name');

  // Source deleted elsewhere in the meantime → 404 NOT_FOUND → readable toast.
  if (isPhone(page)) await page.getByRole('button', { name: /รายการเมนู/ }).first().click();
  dup.products = dup.products.filter((p) => p.id !== 'p-americano');
  await page.getByRole('button', { name: 'คัดลอก อเมริกาโน่' }).click();
  await expect(page.getByText(/ไม่พบ "อเมริกาโน่" แล้ว/)).toBeVisible();
  expect(dup.legacyWrites).toEqual([]);
});

test('barista: no duplicate action', async ({ api, app: page }) => {
  api.role = 'BARISTA';
  await page.reload();
  await goTo(page, 'bom');
  await expect(page.locator('.bom-list-row').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^คัดลอก/ })).toHaveCount(0);
});
