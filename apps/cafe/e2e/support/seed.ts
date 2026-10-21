import type { Route } from '@playwright/test';
import type { MockApi, MockProduct, Call } from './mock-api';

/**
 * Shared rich seed: the visual capture harness (visual/core-screens.capture.ts) and the
 * functional touch-flow spec (pos-touch.spec.ts). Realistic, Thai, and
 * FIXED: every timestamp is relative to FIXED_NOW, which the spec also pins the page
 * clock to, so "opened 45 min ago" / KDS ticket ages render identically on every run.
 */

/** Sunday 4 Oct 2026, 14:30 Bangkok. */
export const FIXED_NOW = new Date('2026-10-04T14:30:00+07:00');
const ago = (min: number) => new Date(FIXED_NOW.getTime() - min * 60_000).toISOString();

const STORE_ID = 'store-e2e-1';

export const CAPTURE_CATEGORIES = [
  { id: 'cat-coffee', store_id: STORE_ID, name: 'กาแฟ', sort_order: 1, is_active: true },
  { id: 'cat-tea', store_id: STORE_ID, name: 'ชา & นม', sort_order: 2, is_active: true },
  { id: 'cat-soda', store_id: STORE_ID, name: 'โซดา & ผลไม้', sort_order: 3, is_active: true },
  { id: 'cat-bakery', store_id: STORE_ID, name: 'เบเกอรี่', sort_order: 4, is_active: true },
  { id: 'cat-food', store_id: STORE_ID, name: 'อาหารจานเดียว', sort_order: 5, is_active: true },
];

const COFFEE_MODS = [{ id: 'mg-size' }, { id: 'mg-sweet' }, { id: 'mg-topping' }];
const TEA_MODS = [{ id: 'mg-sweet' }, { id: 'mg-topping' }];

export const CAPTURE_PRODUCTS: MockProduct[] = [
  // The first entry keeps the shared fixture's name so fixtures.ts' readiness probe still works.
  { id: 'p-latte', name: 'ลาเต้ร้อน', price: '60.00', category_id: 'cat-coffee', modifier_groups: COFFEE_MODS },
  { id: 'p-americano', name: 'อเมริกาโน่', price: '50.00', category_id: 'cat-coffee' },
  { id: 'p-iced-latte', name: 'ลาเต้เย็น', price: '65.00', category_id: 'cat-coffee', modifier_groups: COFFEE_MODS },
  { id: 'p-mocha', name: 'มอคค่าเย็น', price: '70.00', category_id: 'cat-coffee', modifier_groups: COFFEE_MODS },
  { id: 'p-espresso', name: 'เอสเพรสโซ่', price: '45.00', category_id: 'cat-coffee' },
  { id: 'p-thai-tea', name: 'ชาไทยเย็น', price: '55.00', category_id: 'cat-tea', modifier_groups: TEA_MODS },
  { id: 'p-matcha', name: 'มัทฉะลาเต้', price: '75.00', category_id: 'cat-tea', modifier_groups: TEA_MODS },
  { id: 'p-cocoa', name: 'โกโก้เย็น', price: '55.00', category_id: 'cat-tea' },
  { id: 'p-lemon-soda', name: 'เลมอนโซดา', price: '50.00', category_id: 'cat-soda' },
  { id: 'p-yuzu', name: 'ยูซุโซดา', price: '65.00', category_id: 'cat-soda' },
  { id: 'p-croissant', name: 'ครัวซองต์', price: '45.00', category_id: 'cat-bakery' },
  { id: 'p-brownie', name: 'บราวนี่ช็อกโกแลต', price: '55.00', category_id: 'cat-bakery' },
  { id: 'p-cheesecake', name: 'ชีสเค้กบลูเบอร์รี่', price: '85.00', category_id: 'cat-bakery' },
  { id: 'p-basil-rice', name: 'ข้าวกะเพราไก่ไข่ดาว', price: '75.00', category_id: 'cat-food' },
  { id: 'p-carbonara', name: 'สปาเก็ตตี้คาโบนาร่า', price: '120.00', category_id: 'cat-food' },
];

const mod = (id: string, name: string, price: string, sort: number) =>
  ({ id, name, price_delta: price, sort_order: sort, is_active: true });

export const MODIFIER_GROUPS = [
  {
    id: 'mg-size', store_id: STORE_ID, name: 'ขนาดแก้ว', required: true, min_select: 1, max_select: 1, is_active: true,
    modifiers: [mod('m-s', 'S', '0', 1), mod('m-m', 'M', '10', 2), mod('m-l', 'L', '20', 3)],
  },
  {
    id: 'mg-sweet', store_id: STORE_ID, name: 'ความหวาน', required: true, min_select: 1, max_select: 1, is_active: true,
    modifiers: [mod('m-0', '0%', '0', 1), mod('m-25', '25%', '0', 2), mod('m-50', '50%', '0', 3), mod('m-100', '100%', '0', 4)],
  },
  {
    id: 'mg-topping', store_id: STORE_ID, name: 'ท็อปปิ้ง', required: false, min_select: 0, max_select: null, is_active: true,
    modifiers: [mod('m-shot', 'เพิ่มช็อต', '15', 1), mod('m-whip', 'วิปครีม', '10', 2), mod('m-pearl', 'ไข่มุก', '10', 3), mod('m-oat', 'นมโอ๊ต', '20', 4)],
  },
];

// ── Membership ───────────────────────────────────────────────────────────────
export const MEMBER_PHONE = '0812345678';
export const MEMBER_ACCOUNT = {
  id: 'mem-1', customer_id: 'cust-1', customer_name: 'คุณมะลิ ใจดี', phone: MEMBER_PHONE,
  points_balance: 128, lifetime_points_earned: 412, tier: 'SILVER', date_of_birth: '1994-06-12',
  joined_at: '2025-02-14T10:00:00+07:00',
};
const PROGRAM = {
  id: 'prog-1', store_id: STORE_ID, is_active: true, earn_mode: 'PER_BAHT', baht_per_point: '25.00', earn_category_id: null,
  points_to_redeem: 100, reward_type: 'DISCOUNT_FIXED', reward_value: '50.00', reward_scope: 'ORDER', reward_category_id: null,
  min_order_baht: null, points_expire_after_days: 365, tier_bronze_threshold: 100, tier_silver_threshold: 300,
  tier_gold_threshold: 1000, bronze_earn_multiplier: '1.0', silver_earn_multiplier: '1.2', gold_earn_multiplier: '1.5',
  created_at: '2025-01-01T00:00:00+07:00', updated_at: '2025-01-01T00:00:00+07:00',
};

// ── Floor / table sessions (board-game add-on) ───────────────────────────────
export const FLOOR_TABLES = [
  { id: 't-a1', name: 'A1', zone: 'โซนหน้าร้าน', capacity: 2, is_active: true },
  { id: 't-a2', name: 'A2', zone: 'โซนหน้าร้าน', capacity: 4, is_active: true },
  { id: 't-a3', name: 'A3', zone: 'โซนหน้าร้าน', capacity: 4, is_active: true },
  { id: 't-a4', name: 'A4', zone: 'โซนหน้าร้าน', capacity: 6, is_active: true },
  { id: 't-b1', name: 'B1', zone: 'โซนบอร์ดเกม', capacity: 4, is_active: true },
  { id: 't-b2', name: 'B2', zone: 'โซนบอร์ดเกม', capacity: 6, is_active: true },
  { id: 't-b3', name: 'B3', zone: 'โซนบอร์ดเกม', capacity: 8, is_active: true },
  { id: 't-vip', name: 'VIP', zone: 'ห้องส่วนตัว', capacity: 10, is_active: true },
];

const RATE_SNAPSHOT = {
  name: 'รายชั่วโมง ต่อคน', billing_mode: 'PER_HEAD_HOUR', hourly_rate: '40.00', grace_minutes: 10,
  rounding_increment_minutes: 15, min_charge_minutes: 60, daily_cap_amount: '200.00', max_open_minutes: 180,
};
export const RATE_PLANS = [
  { id: 'rp-head', ...RATE_SNAPSHOT, is_default: true, is_active: true },
  {
    id: 'rp-table', name: 'เหมาโต๊ะ รายชั่วโมง', billing_mode: 'PER_TABLE_HOUR', hourly_rate: '150.00', grace_minutes: 10,
    rounding_increment_minutes: 30, min_charge_minutes: 60, daily_cap_amount: null, max_open_minutes: 240, is_default: false, is_active: true,
  },
];

const session = (id: string, tableId: string, party: number, openedMinAgo: number, note: string | null = null) => ({
  id, table_id: tableId, status: 'OPEN', party_size: party, customer_id: null, opened_at: ago(openedMinAgo), closed_at: null,
  rate_plan_id: 'rp-head', rate_snapshot: RATE_SNAPSHOT, time_charge_amount: null, time_charge_order_id: null, note,
});
export const OPEN_SESSIONS = [
  session('ses-a2', 't-a2', 3, 45),
  session('ses-b1', 't-b1', 4, 95, 'เล่น Catan'),
  session('ses-b3', 't-b3', 6, 200),
  session('ses-vip', 't-vip', 8, 6),
];
const BILLING: Record<string, { amount: string; billable_minutes: number; raw_minutes: number; within_grace: boolean; cap_applied: boolean }> = {
  'ses-a2': { amount: '120.00', billable_minutes: 60, raw_minutes: 45, within_grace: false, cap_applied: false },
  'ses-b1': { amount: '320.00', billable_minutes: 120, raw_minutes: 95, within_grace: false, cap_applied: false },
  'ses-b3': { amount: '1200.00', billable_minutes: 210, raw_minutes: 200, within_grace: false, cap_applied: true },
  'ses-vip': { amount: '0.00', billable_minutes: 0, raw_minutes: 6, within_grace: true, cap_applied: false },
};

// ── KDS tickets ──────────────────────────────────────────────────────────────
const mods = (...names: [string, string][]) => ({ modifiers: names.map(([id, name]) => ({ id, name, price_delta: '0' })) });

export function seedKitchen(api: MockApi): void {
  api.seedOrder({
    status: 'PAID', channel: 'DINE_IN', total: '185.00', created_at: ago(2),
    items: [
      { product_name: 'ลาเต้เย็น', quantity: 2, modifiers_json: mods(['m-l', 'L'], ['m-50', '50%']) },
      { product_name: 'ครัวซองต์', quantity: 1, modifiers_json: null },
    ],
  });
  api.seedOrder({
    status: 'PAID', channel: 'TAKEAWAY', total: '130.00', created_at: ago(5),
    items: [
      { product_name: 'ชาไทยเย็น', quantity: 1, modifiers_json: mods(['m-25', '25%'], ['m-pearl', 'ไข่มุก']) },
      { product_name: 'อเมริกาโน่', quantity: 1, modifiers_json: null },
    ],
  });
  api.seedOrder({
    status: 'IN_PROGRESS', channel: 'DINE_IN', total: '195.00', created_at: ago(9),
    items: [
      { product_name: 'ข้าวกะเพราไก่ไข่ดาว', quantity: 1, modifiers_json: null },
      { product_name: 'มัทฉะลาเต้', quantity: 1, modifiers_json: mods(['m-oat', 'นมโอ๊ต']) },
      { product_name: 'เลมอนโซดา', quantity: 1, modifiers_json: null },
    ],
  });
  api.seedOrder({
    status: 'IN_PROGRESS', channel: 'DELIVERY', total: '240.00', created_at: ago(16),
    items: [{ product_name: 'สปาเก็ตตี้คาโบนาร่า', quantity: 2, modifiers_json: null }],
  });
  api.seedOrder({
    status: 'READY', channel: 'TAKEAWAY', total: '140.00', created_at: ago(21),
    items: [
      { product_name: 'มอคค่าเย็น', quantity: 1, modifiers_json: mods(['m-m', 'M'], ['m-whip', 'วิปครีม']) },
      { product_name: 'บราวนี่ช็อกโกแลต', quantity: 1, modifiers_json: null },
    ],
  });
}

// ── Wiring ───────────────────────────────────────────────────────────────────
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });

/** Swap in the capture catalogue, switch on the board-game add-on and answer the extra endpoints. */
export function seedCaptureApi(api: MockApi): void {
  api.categories = CAPTURE_CATEGORIES;
  api.products = CAPTURE_PRODUCTS;
  api.features = ['vertical.boardgame'];
  api.now = () => FIXED_NOW; // orders created during a capture (receipt) carry the pinned time
  seedKitchen(api);
  api.extra.push((c, route) => captureHandler(c, route));
}

async function captureHandler(c: Call, route: Route): Promise<boolean> {
  const { method: m, path: p } = c;

  if (m === 'GET' && p === '/api/v1/modifier-groups') { await json(route, 200, MODIFIER_GROUPS); return true; }
  if (m === 'GET' && p === '/api/v1/membership/program') { await json(route, 200, PROGRAM); return true; }
  if (m === 'POST' && p === '/api/v1/membership/lookup') {
    const phone = (c.body as { phone?: string } | null)?.phone;
    if (phone === MEMBER_PHONE) {
      await json(route, 200, {
        found: true, account: MEMBER_ACCOUNT,
        program: { points_to_redeem: 100, reward_type: 'DISCOUNT_FIXED', reward_scope: 'ORDER', reward_category_name: null },
        reward_redeemable: true, points_to_next_reward: null, eligible_reward_products: [],
      });
    } else {
      await json(route, 200, { found: false, account: null, program: null, reward_redeemable: false, points_to_next_reward: null, eligible_reward_products: [] });
    }
    return true;
  }
  if (m === 'GET' && p === '/api/v1/membership/members') { await json(route, 200, { items: [MEMBER_ACCOUNT], total: 1, page: 1, limit: 20 }); return true; }
  if (m === 'GET' && p === `/api/v1/customers/${MEMBER_ACCOUNT.customer_id}`) {
    await json(route, 200, { id: MEMBER_ACCOUNT.customer_id, store_id: STORE_ID, name: MEMBER_ACCOUNT.customer_name, phone: MEMBER_PHONE, email: null, sales_id: 'sp-1', sales_name: 'น้องเมย์' });
    return true;
  }

  if (m === 'GET' && p === '/api/v1/floor/tables') { await json(route, 200, FLOOR_TABLES); return true; }
  if (m === 'GET' && p === '/api/v1/rate-plans') { await json(route, 200, RATE_PLANS); return true; }
  if (m === 'GET' && p === '/api/v1/table-sessions') {
    const status = new URL(`http://x${c.search}`).searchParams.get('status');
    await json(route, 200, !status || status === 'OPEN' ? OPEN_SESSIONS : []);
    return true;
  }
  const bp = /^\/api\/v1\/table-sessions\/([^/]+)\/billing-preview$/.exec(p);
  if (m === 'GET' && bp) {
    const b = BILLING[bp[1]];
    if (b) await json(route, 200, b); else await json(route, 404, { error: { code: 'NOT_FOUND', message: 'no session' } });
    return true;
  }
  if (m === 'GET' && /^\/api\/v1\/products\/[^/]+\/steps$/.test(p)) { await json(route, 200, []); return true; }
  return false;
}
