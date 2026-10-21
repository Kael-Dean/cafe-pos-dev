import { test as harness, expect, goTo, isPhone, shot } from './support/handoff-fixtures';
import { installPreOrders, type PreOrdersState } from './support/pre-orders-mock';
import { addDaysIso } from '../../../packages/pos-core/lib/pre-order-dates';

/**
 * Handoff pre-orders/calendar-handoff.md (+ the 2026-06-06 date-range filter): the work
 * calendar asks for the visible week only (due_date_from / due_date_to) and shows the due
 * pre-orders per day; the pre-orders screen filters by a due-date range.
 * Tablet landscape 1280×800 + phone 375; screenshots in docs/qa/remaining-handoffs/.
 */

const test = harness.extend<{ h: PreOrdersState }>({
  // auto: installed before the `app` fixture boots the POS, so no query is cached from the default mock.
  h: [async ({ api }, provide) => { await provide(installPreOrders(api)); }, { auto: true }],
});

// ── 1. Pre-orders on the work calendar ──────────────────────────────────────

test('work calendar: due pre-orders of the visible week, grouped per day', async ({ app: page, api, h }) => {
  await goTo(page, 'shifts');

  // The calendar asks for exactly Monday … Sunday of the visible week, limit 200.
  await expect.poll(() => api.find('GET', '/api/v1/pre-orders').length).toBeGreaterThan(0);
  const q = new URLSearchParams(api.find('GET', '/api/v1/pre-orders')[0].search);
  expect(q.get('due_date_from')).toBe(h.monday);
  expect(q.get('due_date_to')).toBe(addDaysIso(h.monday, 6));
  expect(q.get('limit')).toBe('200');
  expect(q.has('status')).toBe(false); // all statuses; CANCELLED is hidden client-side

  const wed = addDaysIso(h.monday, 2);
  if (!isPhone(page)) {
    const cell = page.locator(`[data-po-day="${wed}"]`);
    // 4 active on Wednesday (cancelled hidden) → 3 shown + "+1 เพิ่มเติม"
    await expect(cell.locator('.shift-po-badge')).toHaveCount(3);
    await expect(cell.getByRole('button', { name: '+1 เพิ่มเติม' })).toBeVisible();
    // No customer name → falls back to the phone number; no name or phone → "ลูกค้าไม่ระบุชื่อ".
    await expect(page.locator(`[data-po-day="${addDaysIso(h.monday, 5)}"]`)).toContainText('ลูกค้าไม่ระบุชื่อ');
    await expect(page.locator(`[data-po-day="${addDaysIso(h.monday, 5)}"]`)).toContainText('ยังไม่มีรายการ');
    await expect(page.locator(`[data-po-day="${h.monday}"]`)).toContainText('3 รายการ');
    await shot(page, '01-calendar-week');

    await cell.getByRole('button', { name: '+1 เพิ่มเติม' }).click();
    await expect(cell.locator('.shift-po-badge')).toHaveCount(4);
    await expect(cell).toContainText('0899999999');

    // Cancelled: hidden by default, struck through when shown.
    await page.getByRole('button', { name: 'แสดงที่ยกเลิก' }).click();
    await expect(cell.getByRole('button', { name: /ยกเลิกแล้ว/ })).toHaveCSS('text-decoration-line', 'line-through');
    await shot(page, '02-calendar-expanded-cancelled');

    // Detail drill-down
    await page.locator(`[data-po-day="${h.monday}"]`).locator('.shift-po-badge').first().click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('คุณเอ (เค้กวันเกิด 2 ปอนด์)');
    await expect(dlg).toContainText('เค้กชิ้นที่ 3');
    await shot(page, '03-calendar-detail');
    await page.keyboard.press('Escape');
  } else {
    // Phones: day picker marks days with pre-orders; the day list shows them.
    await page.getByRole('button', { name: new RegExp(`ที่ ${Number(wed.slice(8))} มีกะ .* พรีออเดอร์ 4 รายการ`) }).click();
    await expect(page.getByRole('heading', { name: /พรีออเดอร์ที่ต้องส่ง \(4\)/ })).toBeVisible();
    await expect(page.locator('.shift-list').last()).toContainText('ร้านกาแฟข้างบ้าน');
    await shot(page, '01-calendar-day');
  }

  // Next week → a new range request; the previous week's orders are not in it.
  await page.getByRole('button', { name: 'สัปดาห์ถัดไป' }).click();
  await expect.poll(() => api.find('GET', '/api/v1/pre-orders').some((c) =>
    new URLSearchParams(c.search).get('due_date_from') === addDaysIso(h.monday, 7))).toBe(true);
  expect(api.unhandled.filter((u) => u.includes('pre-orders'))).toEqual([]);
});

test('pre-orders screen: due-date range filter', async ({ app: page, api, h }) => {
  await goTo(page, 'pre-orders');
  await expect(page.getByText('สัปดาห์หน้า')).toBeVisible();

  const wed = addDaysIso(h.monday, 2);
  await page.getByLabel('ส่งตั้งแต่').fill(wed);
  await page.getByLabel('ถึง', { exact: true }).fill(wed);
  await expect.poll(() => api.find('GET', '/api/v1/pre-orders').some((c) => {
    const s = new URLSearchParams(c.search);
    return s.get('due_date_from') === wed && s.get('due_date_to') === wed;
  })).toBe(true);
  await expect(page.getByText('พบ 5 รายการ')).toBeVisible();
  await expect(page.getByText('สัปดาห์หน้า')).toHaveCount(0);
  await shot(page, '04-preorders-range');

  // Combined with the status pill (filters stack)
  await page.getByRole('button', { name: 'Pending', exact: true }).click();
  await expect.poll(() => api.find('GET', '/api/v1/pre-orders').some((c) => {
    const s = new URLSearchParams(c.search);
    return s.get('due_date_from') === wed && s.get('status') === 'PENDING';
  })).toBe(true);
  await expect(page.getByText('พบ 2 รายการ')).toBeVisible();

  // Empty range → empty state with a way out
  const far = addDaysIso(h.monday, 60);
  await page.getByLabel('ถึง', { exact: true }).fill(far);
  await page.getByLabel('ส่งตั้งแต่').fill(far);
  await expect(page.getByText('ไม่มี Pre-Order ที่ครบกำหนดส่งในช่วงนี้')).toBeVisible();
  await page.getByRole('button', { name: 'ล้างช่วงวันที่' }).click();
  await expect(page.getByLabel('ส่งตั้งแต่')).toHaveValue('');
});
