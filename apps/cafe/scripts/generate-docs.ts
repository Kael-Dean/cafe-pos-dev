/**
 * POS Documentation Generator — with full mock-data API interception
 * Run: npx tsx scripts/generate-docs.ts
 * No running server needed; all /api/v1/* calls are intercepted and served from
 * the mock data below, so every screen renders as if the backend is live.
 */
import { chromium, Route } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://cafe-a6czbj0ag-kael-deans-projects.vercel.app';
const OUT_DIR  = join(process.cwd(), 'doc-screenshots');
const HTML_OUT = join(process.cwd(), 'pos-documentation.html');
const PDF_OUT  = join(process.cwd(), 'pos-documentation.pdf');

// ═══════════════════════════════════════════════════════════════════════════
// MOCK DATA  (matches exact API response shapes from the hooks)
// ═══════════════════════════════════════════════════════════════════════════

const STORE_ID  = 'store-0001';
const TENANT_ID = 'tenant-0001';

const ME = {
  id: 'usr-owner-01', name: 'แพรว สุขสม',
  role: 'OWNER', store_id: STORE_ID,
  store_name: 'Café 49 Sukhumvit', tenant_id: TENANT_ID,
};

const CATEGORIES = [
  { id: 'cat-hot',    store_id: STORE_ID, name: 'กาแฟร้อน', sort_order: 1, is_active: true },
  { id: 'cat-cold',   store_id: STORE_ID, name: 'กาแฟเย็น', sort_order: 2, is_active: true },
  { id: 'cat-tea',    store_id: STORE_ID, name: 'ชา',        sort_order: 3, is_active: true },
  { id: 'cat-bakery', store_id: STORE_ID, name: 'เบเกอรี่',  sort_order: 4, is_active: true },
  { id: 'cat-other',  store_id: STORE_ID, name: 'อื่นๆ',     sort_order: 5, is_active: true },
];

const PRODUCTS = [
  { id: 'p-001', store_id: STORE_ID, category_id: 'cat-hot',    name: 'เอสเปรสโซ',         description: 'Double shot espresso', price: '55.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-002', store_id: STORE_ID, category_id: 'cat-hot',    name: 'ลาเต้',              description: 'Espresso + steamed milk',   price: '75.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-003', store_id: STORE_ID, category_id: 'cat-hot',    name: 'คาปูชิโน',           description: null, price: '75.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-004', store_id: STORE_ID, category_id: 'cat-hot',    name: 'มอคค่า',             description: null, price: '85.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-005', store_id: STORE_ID, category_id: 'cat-cold',   name: 'อเมริกาโน่ เย็น',   description: null, price: '70.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-006', store_id: STORE_ID, category_id: 'cat-cold',   name: 'ลาเต้ เย็น',        description: null, price: '80.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-007', store_id: STORE_ID, category_id: 'cat-cold',   name: 'คาราเมล มัคคิอาโต', description: null, price: '95.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-008', store_id: STORE_ID, category_id: 'cat-tea',    name: 'ชาเขียวมัทฉะลาเต้', description: null, price: '90.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-009', store_id: STORE_ID, category_id: 'cat-tea',    name: 'ชาไทย เย็น',        description: null, price: '65.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-010', store_id: STORE_ID, category_id: 'cat-tea',    name: 'ชามะนาว',           description: null, price: '55.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-011', store_id: STORE_ID, category_id: 'cat-bakery', name: 'ครัวซองต์',         description: null, price: '65.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-012', store_id: STORE_ID, category_id: 'cat-bakery', name: 'บราวนี่',           description: null, price: '75.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-013', store_id: STORE_ID, category_id: 'cat-bakery', name: 'คุกกี้ช็อกชิป',    description: null, price: '45.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-014', store_id: STORE_ID, category_id: 'cat-bakery', name: 'ชีสเค้ก',           description: null, price: '95.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-015', store_id: STORE_ID, category_id: 'cat-other',  name: 'น้ำเปล่า',          description: null, price: '20.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
  { id: 'p-016', store_id: STORE_ID, category_id: 'cat-other',  name: 'โซดามะนาว',         description: null, price: '55.00', is_active: true, product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null },
];

const MODIFIER_GROUPS = [
  {
    id: 'mg-001', store_id: STORE_ID, name: 'ขนาด', is_required: true, max_selections: 1, is_active: true, sort_order: 1,
    modifiers: [
      { id: 'mod-s', name: 'S', price_delta: '-5.00', is_active: true, sort_order: 1 },
      { id: 'mod-m', name: 'M', price_delta: '0.00',  is_active: true, sort_order: 2, is_default: true },
      { id: 'mod-l', name: 'L', price_delta: '10.00', is_active: true, sort_order: 3 },
    ],
  },
  {
    id: 'mg-002', store_id: STORE_ID, name: 'นม', is_required: true, max_selections: 1, is_active: true, sort_order: 2,
    modifiers: [
      { id: 'mod-fresh',  name: 'นมสด',       price_delta: '0.00',  is_active: true, sort_order: 1, is_default: true },
      { id: 'mod-oat',    name: 'นมโอ๊ต',     price_delta: '10.00', is_active: true, sort_order: 2 },
      { id: 'mod-almond', name: 'นมอัลมอนด์', price_delta: '15.00', is_active: true, sort_order: 3 },
      { id: 'mod-skim',   name: 'นมพร่อง',    price_delta: '0.00',  is_active: true, sort_order: 4 },
    ],
  },
  {
    id: 'mg-003', store_id: STORE_ID, name: 'ความหวาน', is_required: false, max_selections: 1, is_active: true, sort_order: 3,
    modifiers: [
      { id: 'mod-no',   name: 'ไม่หวาน', price_delta: '0.00', is_active: true, sort_order: 1 },
      { id: 'mod-low',  name: 'น้อย',    price_delta: '0.00', is_active: true, sort_order: 2 },
      { id: 'mod-std',  name: 'ปกติ',    price_delta: '0.00', is_active: true, sort_order: 3, is_default: true },
      { id: 'mod-much', name: 'มาก',     price_delta: '0.00', is_active: true, sort_order: 4 },
    ],
  },
  {
    id: 'mg-004', store_id: STORE_ID, name: 'เพิ่มเติม', is_required: false, max_selections: 4, is_active: true, sort_order: 4,
    modifiers: [
      { id: 'mod-shot',  name: 'เพิ่มช็อต', price_delta: '15.00', is_active: true, sort_order: 1 },
      { id: 'mod-whip',  name: 'วิปครีม',   price_delta: '10.00', is_active: true, sort_order: 2 },
      { id: 'mod-pearl', name: 'มุก',        price_delta: '10.00', is_active: true, sort_order: 3 },
      { id: 'mod-jelly', name: 'เยลลี่',    price_delta: '5.00',  is_active: true, sort_order: 4 },
    ],
  },
];

const now = Date.now();
const KDS_ORDERS = {
  items: [
    { id: 'ord-047', order_number: 47, status: 'PAID',        channel: 'DINE_IN',  total: '150.00', created_at: new Date(now - 60000).toISOString(),    items: [{ product_name: 'ลาเต้',               quantity: 1, modifiers_json: { size: 'M', milk: 'นมโอ๊ต', sweet: 'น้อย', addon: '+ช็อต' } }, { product_name: 'ครัวซองต์', quantity: 1, modifiers_json: {} }] },
    { id: 'ord-046', order_number: 46, status: 'IN_PROGRESS', channel: 'TAKEAWAY', total: '220.00', created_at: new Date(now - 180000).toISOString(),   items: [{ product_name: 'ชาเขียวมัทฉะลาเต้', quantity: 2, modifiers_json: { size: 'L', milk: 'นมอัลมอนด์' } }] },
    { id: 'ord-045', order_number: 45, status: 'IN_PROGRESS', channel: 'DELIVERY', total: '305.00', created_at: new Date(now - 360000).toISOString(),   items: [{ product_name: 'อเมริกาโน่ เย็น', quantity: 1, modifiers_json: { size: 'L' } }, { product_name: 'มอคค่า', quantity: 1, modifiers_json: { milk: 'นมสด', addon: 'วิปครีม' } }, { product_name: 'บราวนี่', quantity: 2, modifiers_json: {} }] },
    { id: 'ord-044', order_number: 44, status: 'IN_PROGRESS', channel: 'DINE_IN',  total: '290.00', created_at: new Date(now - 660000).toISOString(),   items: [{ product_name: 'คาปูชิโน', quantity: 3, modifiers_json: { size: 'M', milk: 'นมสด' } }, { product_name: 'ชาไทย เย็น', quantity: 1, modifiers_json: { size: 'L' } }] },
    { id: 'ord-043', order_number: 43, status: 'READY',       channel: 'TAKEAWAY', total: '185.00', created_at: new Date(now - 240000).toISOString(),   items: [{ product_name: 'คาราเมล มัคคิอาโต', quantity: 1, modifiers_json: { size: 'M', sweet: 'น้อย' } }, { product_name: 'คุกกี้ช็อกชิป', quantity: 2, modifiers_json: {} }] },
    { id: 'ord-042', order_number: 42, status: 'PAID',        channel: 'DINE_IN',  total: '80.00',  created_at: new Date(now - 120000).toISOString(),   items: [{ product_name: 'ลาเต้ เย็น', quantity: 1, modifiers_json: { size: 'L', milk: 'นมโอ๊ต' } }] },
  ],
  total: 6, page: 1, limit: 200,
};

const DASHBOARD_TODAY = {
  revenue: '18420.00', order_count: 184, avg_ticket: '100.11',
  top_items: [
    { product_name: 'ลาเต้',              quantity: 42, revenue: '3150.00' },
    { product_name: 'อเมริกาโน่ เย็น',    quantity: 31, revenue: '2170.00' },
    { product_name: 'คาราเมล มัคคิอาโต',  quantity: 22, revenue: '2090.00' },
    { product_name: 'ชาเขียวมัทฉะลาเต้',  quantity: 18, revenue: '1620.00' },
    { product_name: 'ครัวซองต์',          quantity: 24, revenue: '1560.00' },
    { product_name: 'มอคค่า',             quantity: 16, revenue: '1360.00' },
    { product_name: 'คาปูชิโน',           quantity: 17, revenue: '1275.00' },
    { product_name: 'บราวนี่',            quantity: 14, revenue: '1050.00' },
    { product_name: 'ชาไทย เย็น',         quantity: 12, revenue: '780.00'  },
    { product_name: 'คุกกี้ช็อกชิป',     quantity: 13, revenue: '585.00'  },
  ],
};

const buildHourlyBuckets = (values: number[], offset = 0) => {
  const date = new Date(); date.setDate(date.getDate() - offset);
  const ymd = date.toISOString().slice(0, 10);
  const hours = ['08','09','10','11','12','13','14','15','16','17','18','19','20'];
  return {
    buckets: hours.map((h, i) => ({ bucket: `${ymd}T${h}:00`, order_count: Math.round(values[i] / 100), revenue: String(values[i]) })),
    total_revenue: String(values.reduce((a, b) => a + b, 0)),
    total_orders: values.reduce((a, b) => a + Math.round(b / 100), 0),
  };
};

const TODAY_SALES    = buildHourlyBuckets([320, 880, 1620, 2180, 2840, 2410, 1480, 1240, 1880, 2160, 940, 320, 150]);
const LASTWEEK_SALES = buildHourlyBuckets([280, 760, 1450, 1920, 2680, 2120, 1390, 1100, 1560, 1840, 880, 410, 220], 7);

const CASHIER_SHIFTS = {
  from_: new Date().toISOString(), to: new Date().toISOString(),
  cashiers: [
    { user_id: 'u1', user_name: 'แพรว สุขสม',    order_count: 64, revenue: '6240.00', void_count: 0 },
    { user_id: 'u2', user_name: 'นัท พรหมสิทธิ์', order_count: 51, revenue: '5180.00', void_count: 1 },
    { user_id: 'u3', user_name: 'มิ้น กาญจนา',    order_count: 48, revenue: '4890.00', void_count: 0 },
    { user_id: 'u4', user_name: 'ก้อง วิชัย',     order_count: 21, revenue: '2110.00', void_count: 0 },
  ],
};

const INVENTORY_ITEMS = [
  { id: 'inv-001', name: 'เมล็ดกาแฟ Arabica',     unit: 'g',   cost_per_unit: '0.50', stock_on_hand: '480',   par_level: '1500', is_active: true, status: 'critical', unit_size: '1000g/ถุง', unit_price: '500.00' },
  { id: 'inv-002', name: 'เมล็ดกาแฟ Robusta',     unit: 'g',   cost_per_unit: '0.30', stock_on_hand: '1200',  par_level: '1000', is_active: true, status: 'ok',       unit_size: null,          unit_price: null },
  { id: 'inv-003', name: 'นมสด',                   unit: 'ml',  cost_per_unit: '0.06', stock_on_hand: '8400',  par_level: '6000', is_active: true, status: 'ok',       unit_size: '1000ml/กล่อง', unit_price: '60.00' },
  { id: 'inv-004', name: 'นมโอ๊ต Oatside',        unit: 'ml',  cost_per_unit: '0.18', stock_on_hand: '2100',  par_level: '4000', is_active: true, status: 'low',      unit_size: '1000ml/กล่อง', unit_price: '180.00' },
  { id: 'inv-005', name: 'นมอัลมอนด์',             unit: 'ml',  cost_per_unit: '0.20', stock_on_hand: '1800',  par_level: '2000', is_active: true, status: 'low',      unit_size: null,          unit_price: null },
  { id: 'inv-006', name: 'ผงมัทฉะ',                unit: 'g',   cost_per_unit: '1.20', stock_on_hand: '320',   par_level: '300',  is_active: true, status: 'ok',       unit_size: '500g/กระป๋อง', unit_price: '600.00' },
  { id: 'inv-007', name: 'ใบชาดำ',                 unit: 'g',   cost_per_unit: '0.40', stock_on_hand: '850',   par_level: '500',  is_active: true, status: 'ok',       unit_size: null,          unit_price: null },
  { id: 'inv-008', name: 'น้ำตาล',                 unit: 'g',   cost_per_unit: '0.04', stock_on_hand: '5200',  par_level: '3000', is_active: true, status: 'ok',       unit_size: null,          unit_price: null },
  { id: 'inv-009', name: 'น้ำเชื่อมคาราเมล',      unit: 'ml',  cost_per_unit: '0.50', stock_on_hand: '1600',  par_level: '1000', is_active: true, status: 'ok',       unit_size: null,          unit_price: null },
  { id: 'inv-010', name: 'วิปครีม',                unit: 'ml',  cost_per_unit: '0.30', stock_on_hand: '980',   par_level: '800',  is_active: true, status: 'ok',       unit_size: null,          unit_price: null },
  { id: 'inv-011', name: 'แก้วเย็น 16 oz',         unit: 'ใบ',  cost_per_unit: '3.00', stock_on_hand: '38',    par_level: '100',  is_active: true, status: 'critical', unit_size: '50ใบ/ห่อ',   unit_price: '150.00' },
  { id: 'inv-012', name: 'แก้วร้อน 12 oz',         unit: 'ใบ',  cost_per_unit: '2.50', stock_on_hand: '320',   par_level: '200',  is_active: true, status: 'ok',       unit_size: null,          unit_price: null },
  { id: 'inv-013', name: 'น้ำแข็ง',                unit: 'g',   cost_per_unit: '0.01', stock_on_hand: '50000', par_level: '30000',is_active: true, status: 'ok',       unit_size: null,          unit_price: null },
  { id: 'inv-014', name: 'ครัวซองต์ดิบ (พรีเบค)', unit: 'ชิ้น',cost_per_unit: '18.00',stock_on_hand: '24',    par_level: '30',   is_active: true, status: 'low',      unit_size: null,          unit_price: null },
  { id: 'inv-015', name: 'บราวนี่ดิบ',             unit: 'ชิ้น',cost_per_unit: '22.00',stock_on_hand: '18',    par_level: '20',   is_active: true, status: 'low',      unit_size: null,          unit_price: null },
];

const STOCK_MOVEMENTS = {
  items: [
    { id: 'mv-1', type: 'RECEIVE', inventory_item_id: 'inv-001', quantity: '1000', reason_code: null, note: 'รับเข้าประจำสัปดาห์',  supplier: 'กาแฟดอยช้าง', created_by: { id: 'u1', name: 'แพรว' }, created_at: new Date(now - 86400000*2).toISOString() },
    { id: 'mv-2', type: 'RECEIVE', inventory_item_id: 'inv-003', quantity: '5000', reason_code: null, note: '',                       supplier: 'CP Fresh Milk',  created_by: { id: 'u1', name: 'แพรว' }, created_at: new Date(now - 86400000).toISOString() },
    { id: 'mv-3', type: 'WASTE',   inventory_item_id: 'inv-003', quantity: '200',  reason_code: 'EXPIRED', note: 'เปิดทิ้งค้างคืน', supplier: null, created_by: { id: 'u1', name: 'แพรว' }, created_at: new Date(now - 86400000).toISOString() },
    { id: 'mv-4', type: 'WASTE',   inventory_item_id: 'inv-001', quantity: '30',   reason_code: 'SPILLED', note: 'หกขณะชง',          supplier: null, created_by: { id: 'u3', name: 'มิ้น' }, created_at: new Date(now - 18000000).toISOString() },
    { id: 'mv-5', type: 'RECEIVE', inventory_item_id: 'inv-011', quantity: '200',  reason_code: null, note: 'จัดส่งช้า 1 วัน',       supplier: 'ทรัพย์เจริญ', created_by: { id: 'u3', name: 'มิ้น' }, created_at: new Date(now - 86400000*5).toISOString() },
  ],
  next_cursor: null,
};

// ProductDetailRead — what BOM Builder calls via GET /api/v1/products/${id}
// recipe uses field name "quantity" (not "qty") per use-bom.ts RecipeItemRead
const MG_SUMMARY = [
  { id: 'mg-001', name: 'ขนาด',      required: true,  min_select: 1, max_select: 1 },
  { id: 'mg-002', name: 'นม',        required: true,  min_select: 1, max_select: 1 },
  { id: 'mg-003', name: 'ความหวาน', required: false, min_select: 0, max_select: 1 },
  { id: 'mg-004', name: 'เพิ่มเติม', required: false, min_select: 0, max_select: 4 },
];

// modifier_groups always [] so POS never opens modal on click
// (BOM Builder gets recipe data; modifier section just shows empty — acceptable for docs)
const PRODUCT_DETAILS: Record<string, object> = {
  'p-001': { ...PRODUCTS[0],  modifier_groups: [], recipe: [{ id: 'ri-1a', inventory_item_id: 'inv-001', quantity: '18' }, { id: 'ri-1b', inventory_item_id: 'inv-012', quantity: '1' }] },
  'p-002': { ...PRODUCTS[1],  modifier_groups: [], recipe: [{ id: 'ri-2a', inventory_item_id: 'inv-001', quantity: '18' }, { id: 'ri-2b', inventory_item_id: 'inv-003', quantity: '200' }, { id: 'ri-2c', inventory_item_id: 'inv-012', quantity: '1' }, { id: 'ri-2d', inventory_item_id: 'inv-008', quantity: '5' }] },
  'p-003': { ...PRODUCTS[2],  modifier_groups: [], recipe: [{ id: 'ri-3a', inventory_item_id: 'inv-001', quantity: '18' }, { id: 'ri-3b', inventory_item_id: 'inv-003', quantity: '150' }, { id: 'ri-3c', inventory_item_id: 'inv-012', quantity: '1' }] },
  'p-004': { ...PRODUCTS[3],  modifier_groups: [], recipe: [{ id: 'ri-4a', inventory_item_id: 'inv-001', quantity: '18' }, { id: 'ri-4b', inventory_item_id: 'inv-003', quantity: '200' }, { id: 'ri-4c', inventory_item_id: 'inv-009', quantity: '10' }, { id: 'ri-4d', inventory_item_id: 'inv-010', quantity: '20' }, { id: 'ri-4e', inventory_item_id: 'inv-012', quantity: '1' }] },
  'p-005': { ...PRODUCTS[4],  modifier_groups: [], recipe: [{ id: 'ri-5a', inventory_item_id: 'inv-001', quantity: '18' }, { id: 'ri-5b', inventory_item_id: 'inv-013', quantity: '200' }, { id: 'ri-5c', inventory_item_id: 'inv-011', quantity: '1' }] },
  'p-006': { ...PRODUCTS[5],  modifier_groups: [], recipe: [{ id: 'ri-6a', inventory_item_id: 'inv-001', quantity: '18' }, { id: 'ri-6b', inventory_item_id: 'inv-003', quantity: '180' }, { id: 'ri-6c', inventory_item_id: 'inv-013', quantity: '150' }, { id: 'ri-6d', inventory_item_id: 'inv-011', quantity: '1' }] },
  'p-007': { ...PRODUCTS[6],  modifier_groups: [], recipe: [{ id: 'ri-7a', inventory_item_id: 'inv-001', quantity: '18' }, { id: 'ri-7b', inventory_item_id: 'inv-003', quantity: '200' }, { id: 'ri-7c', inventory_item_id: 'inv-009', quantity: '30' }, { id: 'ri-7d', inventory_item_id: 'inv-013', quantity: '150' }, { id: 'ri-7e', inventory_item_id: 'inv-011', quantity: '1' }] },
  'p-008': { ...PRODUCTS[7],  modifier_groups: [], recipe: [{ id: 'ri-8a', inventory_item_id: 'inv-006', quantity: '10' }, { id: 'ri-8b', inventory_item_id: 'inv-003', quantity: '200' }, { id: 'ri-8c', inventory_item_id: 'inv-013', quantity: '150' }, { id: 'ri-8d', inventory_item_id: 'inv-011', quantity: '1' }] },
  'p-009': { ...PRODUCTS[8],  modifier_groups: [], recipe: [{ id: 'ri-9a', inventory_item_id: 'inv-007', quantity: '8'  }, { id: 'ri-9b', inventory_item_id: 'inv-003', quantity: '100' }, { id: 'ri-9c', inventory_item_id: 'inv-008', quantity: '15' }, { id: 'ri-9d', inventory_item_id: 'inv-013', quantity: '150' }, { id: 'ri-9e', inventory_item_id: 'inv-011', quantity: '1' }] },
  'p-010': { ...PRODUCTS[9],  modifier_groups: [], recipe: [{ id: 'ri-10a', inventory_item_id: 'inv-007', quantity: '8' }, { id: 'ri-10b', inventory_item_id: 'inv-003', quantity: '100' }, { id: 'ri-10c', inventory_item_id: 'inv-011', quantity: '1' }] },
  'p-011': { ...PRODUCTS[10], modifier_groups: [], recipe: [{ id: 'ri-11a', inventory_item_id: 'inv-014', quantity: '1' }] },
  'p-012': { ...PRODUCTS[11], modifier_groups: [], recipe: [{ id: 'ri-12a', inventory_item_id: 'inv-015', quantity: '1' }] },
  'p-013': { ...PRODUCTS[12], modifier_groups: [], recipe: [{ id: 'ri-13a', inventory_item_id: 'inv-014', quantity: '1' }] },
  'p-014': { ...PRODUCTS[13], modifier_groups: [], recipe: [{ id: 'ri-14a', inventory_item_id: 'inv-015', quantity: '1' }] },
  'p-015': { ...PRODUCTS[14], modifier_groups: [], recipe: [] },
  'p-016': { ...PRODUCTS[15], modifier_groups: [], recipe: [{ id: 'ri-16a', inventory_item_id: 'inv-013', quantity: '150' }, { id: 'ri-16b', inventory_item_id: 'inv-011', quantity: '1' }] },
};

const PRE_ORDERS = {
  items: [
    { id: 'po-001', order_number: 'PO-001', customer_name: 'คุณสมชาย', customer_phone: '081-234-5678', pickup_date: new Date(now + 86400000).toISOString().slice(0, 10), pickup_time: '14:00', deposit: '200.00', status: 'PENDING',     note: 'ขอขนมน่ารักๆ ด้วยนะคะ', total: '650.00', created_at: new Date(now - 3600000).toISOString(), items: [{ id: 'poi-1', product_id: 'p-014', product_name: 'ชีสเค้ก', quantity: 2, unit_price: '95.00', subtotal: '190.00' }, { id: 'poi-2', product_id: 'p-011', product_name: 'ครัวซองต์', quantity: 4, unit_price: '65.00', subtotal: '260.00' }] },
    { id: 'po-002', order_number: 'PO-002', customer_name: 'คุณมาลี',  customer_phone: '089-876-5432', pickup_date: new Date(now + 172800000).toISOString().slice(0, 10), pickup_time: '10:00', deposit: '500.00', status: 'IN_PROGRESS', note: '', total: '1140.00', created_at: new Date(now - 86400000).toISOString(), items: [{ id: 'poi-3', product_id: 'p-002', product_name: 'ลาเต้', quantity: 6, unit_price: '75.00', subtotal: '450.00' }, { id: 'poi-4', product_id: 'p-013', product_name: 'คุกกี้ช็อกชิป', quantity: 8, unit_price: '45.00', subtotal: '360.00' }] },
    { id: 'po-003', order_number: 'PO-003', customer_name: 'บริษัท ABC', customer_phone: '02-123-4567',  pickup_date: new Date(now - 86400000).toISOString().slice(0, 10),  pickup_time: '09:00', deposit: '1000.00', status: 'COMPLETED',  note: 'สำหรับประชุม 20 คน', total: '2200.00', created_at: new Date(now - 172800000).toISOString(), items: [{ id: 'poi-5', product_id: 'p-001', product_name: 'เอสเปรสโซ', quantity: 10, unit_price: '55.00', subtotal: '550.00' }] },
  ],
  total: 3, page: 1, limit: 20,
};

const SHOPPING_LIST = [
  { id: 'sl-001', inventory_item_id: 'inv-001', inventory_item_name: 'เมล็ดกาแฟ Arabica',    unit: 'g',    quantity_needed: '1020', quantity_ordered: '0', status: 'PENDING', note: 'สต็อกใกล้หมด', created_at: new Date(now).toISOString() },
  { id: 'sl-002', inventory_item_id: 'inv-004', inventory_item_name: 'นมโอ๊ต Oatside',       unit: 'ml',   quantity_needed: '1900', quantity_ordered: '0', status: 'PENDING', note: '',              created_at: new Date(now).toISOString() },
  { id: 'sl-003', inventory_item_id: 'inv-011', inventory_item_name: 'แก้วเย็น 16 oz',        unit: 'ใบ',   quantity_needed: '62',   quantity_ordered: '0', status: 'PENDING', note: 'เหลือน้อยมาก', created_at: new Date(now).toISOString() },
  { id: 'sl-004', inventory_item_id: 'inv-014', inventory_item_name: 'ครัวซองต์ดิบ (พรีเบค)',unit: 'ชิ้น', quantity_needed: '6',    quantity_ordered: '0', status: 'PENDING', note: '',              created_at: new Date(now).toISOString() },
  { id: 'sl-005', inventory_item_id: 'inv-015', inventory_item_name: 'บราวนี่ดิบ',            unit: 'ชิ้น', quantity_needed: '2',    quantity_ordered: '0', status: 'ORDERED', note: 'ติดต่อ supplier แล้ว', created_at: new Date(now - 3600000).toISOString() },
];

const STOCK_TAKE_PREVIEW = {
  id: 'st-preview-001',
  items: INVENTORY_ITEMS.map(inv => ({
    inventory_item_id: inv.id,
    inventory_item_name: inv.name,
    unit: inv.unit,
    system_qty: Number(inv.stock_on_hand),
    counted_qty: null,
    variance: null,
  })),
};

const STOCK_TAKE_HISTORY = [
  { id: 'sth-001', submitted_at: new Date(now - 86400000 * 7).toISOString(),  submitted_by: { id: 'u1', name: 'แพรว' }, total_items: 15, total_variance: -42, status: 'SUBMITTED' },
  { id: 'sth-002', submitted_at: new Date(now - 86400000 * 14).toISOString(), submitted_by: { id: 'u2', name: 'นัท' },  total_items: 15, total_variance: 0,   status: 'SUBMITTED' },
];

const CASH_SESSION_CURRENT = {
  id: 'cs-001', store_id: STORE_ID,
  opened_by: { id: 'u1', name: 'แพรว สุขสม' },
  opened_at: new Date(now - 7200000).toISOString(),
  opening_float: '2000.00',
  expected_cash: '7420.00',
  status: 'OPEN',
  drops: [
    { id: 'drop-1', amount: '3000.00', note: 'นำฝากธนาคารรอบเที่ยง', created_at: new Date(now - 3600000).toISOString() },
  ],
};

const PROMOTIONS = [
  { id: 'promo-001', name: 'Happy Hour 14:00-16:00', type: 'PERCENT_DISCOUNT', value: '20.00', min_order: '0.00', max_uses: null, uses_count: 47, is_active: true, start_date: null, end_date: null, code: null, description: 'ลด 20% ทุกเมนูเวลา 14.00-16.00' },
  { id: 'promo-002', name: 'ซื้อ 2 แถม 1 เบเกอรี่', type: 'BUY_X_GET_Y',     value: '1.00',  min_order: '0.00', max_uses: null, uses_count: 23, is_active: true, start_date: null, end_date: null, code: null, description: 'ซื้อเบเกอรี่ 2 ชิ้น แถม 1 ชิ้น' },
  { id: 'promo-003', name: 'WELCOME10',               type: 'FIXED_DISCOUNT',  value: '10.00', min_order: '50.00', max_uses: 100, uses_count: 67, is_active: true, start_date: null, end_date: null, code: 'WELCOME10', description: 'ส่วนลด ฿10 สำหรับลูกค้าใหม่' },
  { id: 'promo-004', name: 'วันเกิดฟรีเครื่องดื่ม',  type: 'PERCENT_DISCOUNT', value: '100.00',min_order: '0.00', max_uses: null, uses_count: 12, is_active: false, start_date: null, end_date: null, code: 'BDAY', description: 'เครื่องดื่ม 1 แก้วฟรีในวันเกิด' },
];

const PROTOCOLS = [
  { id: 'prot-001', store_id: STORE_ID, name: 'เปิดร้านประจำวัน',   description: null, frequency: 'OPENING', is_active: true, created_by_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    tasks: [{ id: 'pt-1a', protocol_id: 'prot-001', title: 'เช็ค inventory ว่าของครบก่อนเปิด', sort_order: 1 }, { id: 'pt-1b', protocol_id: 'prot-001', title: 'เปิดเครื่องชง warm-up 15 นาที', sort_order: 2 }, { id: 'pt-1c', protocol_id: 'prot-001', title: 'ตรวจสอบความสะอาดพื้นที่', sort_order: 3 }, { id: 'pt-1d', protocol_id: 'prot-001', title: 'เปิดระบบ POS และล็อกอิน', sort_order: 4 }] },
  { id: 'prot-002', store_id: STORE_ID, name: 'ปิดร้านประจำวัน',     description: null, frequency: 'CLOSING', is_active: true, created_by_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    tasks: [{ id: 'pt-2a', protocol_id: 'prot-002', title: 'นับเงินสดและทำ Cash Reconciliation', sort_order: 1 }, { id: 'pt-2b', protocol_id: 'prot-002', title: 'ล้างทำความสะอาดเครื่องชง', sort_order: 2 }, { id: 'pt-2c', protocol_id: 'prot-002', title: 'บันทึก Stock Take', sort_order: 3 }, { id: 'pt-2d', protocol_id: 'prot-002', title: 'ล็อคประตูและตั้ง alarm', sort_order: 4 }] },
  { id: 'prot-003', store_id: STORE_ID, name: 'มาตรฐานการชงกาแฟ',    description: 'Espresso extraction standard', frequency: 'DAILY', is_active: true, created_by_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    tasks: [{ id: 'pt-3a', protocol_id: 'prot-003', title: 'บด grind size 18g ต่อช็อต', sort_order: 1 }, { id: 'pt-3b', protocol_id: 'prot-003', title: 'pressure 9 bar, extraction 25-30 วินาที', sort_order: 2 }, { id: 'pt-3c', protocol_id: 'prot-003', title: 'ตรวจสอบสี crema ควรเป็นน้ำตาลทอง', sort_order: 3 }] },
  { id: 'prot-004', store_id: STORE_ID, name: 'จัดการ Food Safety',   description: null, frequency: 'DAILY', is_active: true, created_by_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    tasks: [{ id: 'pt-4a', protocol_id: 'prot-004', title: 'เช็คอุณหภูมิตู้เย็นทุกเช้า (2-8°C)', sort_order: 1 }, { id: 'pt-4b', protocol_id: 'prot-004', title: 'ล้างมือก่อนและหลังจับอาหาร', sort_order: 2 }, { id: 'pt-4c', protocol_id: 'prot-004', title: 'ระบุวันหมดอายุของของสดทุกวัน', sort_order: 3 }] },
];

const HR_STAFF = [
  { id: 'u1', name: 'แพรว สุขสม',    role: 'OWNER',   position: 'HEAD_OF_STAFF', phone: '081-234-5678', email: 'praew@cafe49.com',  address: null, is_active: true },
  { id: 'u2', name: 'นัท พรหมสิทธิ์', role: 'MANAGER', position: 'SENIOR',        phone: '082-345-6789', email: 'nat@cafe49.com',    address: null, is_active: true },
  { id: 'u3', name: 'มิ้น กาญจนา',    role: 'BARISTA', position: 'JUNIOR',        phone: '083-456-7890', email: null,               address: null, is_active: true },
  { id: 'u4', name: 'ก้อง วิชัย',     role: 'BAKER',   position: 'SENIOR',        phone: '084-567-8901', email: null,               address: null, is_active: true },
  { id: 'u5', name: 'บิ้ว ธนพล',     role: 'BARISTA', position: 'JUNIOR',        phone: '085-678-9012', email: null,               address: null, is_active: true },
];

const today = new Date().toISOString().slice(0, 10);
const HR_SHIFTS = [
  { id: 'sh-1', store_id: STORE_ID, user_id: 'u1', user_name: 'แพรว',  assignment_date: today, start_time: '08:00:00', end_time: '17:00:00', notes: null, created_by_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'sh-2', store_id: STORE_ID, user_id: 'u2', user_name: 'นัท',   assignment_date: today, start_time: '10:00:00', end_time: '19:00:00', notes: null, created_by_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'sh-3', store_id: STORE_ID, user_id: 'u3', user_name: 'มิ้น',  assignment_date: today, start_time: '08:00:00', end_time: '17:00:00', notes: null, created_by_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'sh-4', store_id: STORE_ID, user_id: 'u5', user_name: 'บิ้ว',  assignment_date: today, start_time: '13:00:00', end_time: '21:00:00', notes: 'กะบ่าย', created_by_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

const HR_LEAVES = [
  { id: 'lv-1', store_id: STORE_ID, user_id: 'u3', user_name: 'มิ้น กาญจนา', start_date: new Date(now + 86400000*3).toISOString().slice(0,10), end_date: new Date(now + 86400000*4).toISOString().slice(0,10), leave_type: 'SICK',     status: 'PENDING',  note: 'ไม่สบาย', reviewed_by_id: null, reviewed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'lv-2', store_id: STORE_ID, user_id: 'u5', user_name: 'บิ้ว ธนพล',   start_date: new Date(now + 86400000*7).toISOString().slice(0,10), end_date: new Date(now + 86400000*9).toISOString().slice(0,10), leave_type: 'VACATION', status: 'APPROVED', note: 'ไปต่างประเทศ', reviewed_by_id: 'u1', reviewed_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

const HR_TASKS = [
  { id: 'task-1', store_id: STORE_ID, assignee_id: 'u3', assignee_name: 'มิ้น', created_by_id: 'u2', title: 'ล้างเครื่องชงกาแฟประจำสัปดาห์', description: 'Deep clean ทุกส่วนของ La Marzocco',  status: 'TODO',        due_date: new Date(now + 86400000).toISOString().slice(0,10), created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'task-2', store_id: STORE_ID, assignee_id: 'u4', assignee_name: 'ก้อง', created_by_id: 'u2', title: 'สั่งวัตถุดิบเบเกอรี่',              description: 'ครัวซองต์ บราวนี่ ชีสเค้กดิบ',       status: 'IN_PROGRESS', due_date: new Date(now).toISOString().slice(0,10),             created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'task-3', store_id: STORE_ID, assignee_id: 'u2', assignee_name: 'นัท',  created_by_id: 'u1', title: 'ทำรายงานยอดขายเดือนนี้',              description: null,                                   status: 'DONE',        due_date: new Date(now - 86400000).toISOString().slice(0,10),  created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE INTERCEPTOR
// ═══════════════════════════════════════════════════════════════════════════

function ok(data: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(data) };
}

async function handleApiRoute(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const method = route.request().method();

  // Only intercept read requests; let mutations fall through (they'll fail silently)
  if (method !== 'GET') { await route.continue(); return; }

  // Auth
  if (path.endsWith('/auth/me'))                               return route.fulfill(ok(ME));

  // Catalog
  if (path.endsWith('/categories'))                            return route.fulfill(ok(CATEGORIES));

  // Individual product detail — BOM Builder: GET /products/{id} returns embedded recipe + modifier_groups
  const singleProductMatch = path.match(/\/products\/(p-\d+)$/);
  if (singleProductMatch) {
    const detail = PRODUCT_DETAILS[singleProductMatch[1]];
    return route.fulfill(ok(detail ?? PRODUCTS.find(p => p.id === singleProductMatch[1]) ?? PRODUCTS[0]));
  }

  // Product list — POS / Catalog: GET /products or /products?...
  if (path.endsWith('/products') || (path.includes('/products?') && !path.includes('/products/')))
    return route.fulfill(ok(PRODUCTS));

  // Sub-routes on products (steps, etc.)
  if (path.includes('/products/') && path.endsWith('/steps')) return route.fulfill(ok([]));
  if (path.includes('/products/') && path.includes('/modifier-groups')) return route.fulfill(ok([]));

  // Modifier groups list — return empty so POS adds items directly without modal
  if (path.includes('/modifier-groups') && !path.includes('/modifiers')) return route.fulfill(ok([]));

  // Orders (KDS + POS)
  if (path.endsWith('/orders'))                                return route.fulfill(ok(KDS_ORDERS));

  // Dashboard
  if (path.endsWith('/dashboard/today'))                       return route.fulfill(ok(DASHBOARD_TODAY));
  if (path.includes('/reports/sales'))                         return route.fulfill(ok(url.searchParams.toString().includes('prev') ? LASTWEEK_SALES : (url.searchParams.get('from')?.includes(new Date(now - 86400000*8).toISOString().slice(0,4)) ? LASTWEEK_SALES : TODAY_SALES)));
  if (path.includes('/reports/cashier-shifts'))                return route.fulfill(ok(CASHIER_SHIFTS));

  // Inventory
  if (path.endsWith('/inventory') || path.includes('/inventory?')) return route.fulfill(ok(INVENTORY_ITEMS));
  if (path.includes('/inventory/movements'))                   return route.fulfill(ok(STOCK_MOVEMENTS));
  if (path.includes('/inventory/') && path.endsWith('/lots')) return route.fulfill(ok({ items: [], next_cursor: null }));
  if (path.includes('/inventory/') && path.includes('/supplier-history')) return route.fulfill(ok([]));
  if (path.endsWith('/inventory/expired'))                     return route.fulfill(ok([]));

  // Pre-orders
  if (path.endsWith('/pre-orders') || path.includes('/pre-orders?')) return route.fulfill(ok(PRE_ORDERS));
  if (path.includes('/pre-orders/') && path.endsWith('/ingredients')) return route.fulfill(ok({ items: [], threshold: 0.5 }));

  // Shopping list
  if (path.endsWith('/shopping-list') || path.includes('/shopping-list?')) return route.fulfill(ok(SHOPPING_LIST));

  // Stock take
  if (path.endsWith('/stock-takes/preview'))                   return route.fulfill(ok(STOCK_TAKE_PREVIEW));
  if (path.endsWith('/stock-takes/history'))                   return route.fulfill(ok(STOCK_TAKE_HISTORY));
  if (path.endsWith('/stock-takes'))                           return route.fulfill(ok([]));

  // Cash
  if (path.includes('/hr/cash-sessions/current'))              return route.fulfill(ok(CASH_SESSION_CURRENT));
  if (path.includes('/hr/cash-sessions'))                      return route.fulfill(ok({ items: [], total: 0 }));

  // Promotions
  if (path.endsWith('/promotions') || path.includes('/promotions?')) return route.fulfill(ok(PROMOTIONS));

  // Protocols
  if (path.endsWith('/protocols'))                             return route.fulfill(ok(PROTOCOLS));
  if (path.endsWith('/protocols/logs/today'))                  return route.fulfill(ok([]));

  // HR
  if (path.endsWith('/hr/staff'))                              return route.fulfill(ok(HR_STAFF));
  if (path.endsWith('/hr/shifts') || path.includes('/hr/shifts?')) return route.fulfill(ok(HR_SHIFTS));
  if (path.endsWith('/hr/leaves'))                             return route.fulfill(ok(HR_LEAVES));
  if (path.endsWith('/hr/leaves/mine'))                        return route.fulfill(ok([]));
  if (path.endsWith('/hr/tasks') || path.includes('/hr/tasks?')) return route.fulfill(ok({ items: HR_TASKS, total: HR_TASKS.length }));

  // Receipts
  if (path.endsWith('/receipts') || path.includes('/receipts?')) return route.fulfill(ok({ items: [], total: 0, page: 1, limit: 20 }));

  // Cooking steps
  if (path.includes('/steps'))                                 return route.fulfill(ok([]));

  // Fall through — let the request proceed (static assets, etc.)
  await route.continue();
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

interface ScreenDef {
  id: string;
  label: string;
  navLabel?: string;
  descTH: string;
  descEN: string;
}

const SCREENS: ScreenDef[] = [
  { id: 'login', label: 'Login', descTH: 'หน้าเข้าสู่ระบบ — กรอก Store ID และ PIN 4 หลักขึ้นไป เพื่อรับ Access Token และเข้าสู่ระบบ', descEN: 'Authentication screen. Enter Store ID and PIN (≥4 digits) to receive an access token.' },
  { id: 'pos',         label: 'POS Terminal',            navLabel: 'POS Terminal',     descTH: 'หน้าขายหลัก — เลือกสินค้าจากเมนู เพิ่ม modifier (ขนาด นม ความหวาน) สร้างออเดอร์ และรับชำระเงินสด/QR/บัตร', descEN: 'Main sales screen. Select items, add modifiers, build orders, and accept cash/QR/card.' },
  { id: 'kds',         label: 'Kitchen Display (KDS)',   navLabel: 'Kitchen (KDS)',    descTH: 'จอครัว — แสดงออเดอร์ที่รอทำ real-time พร้อมสถานะ (รอ/กำลังทำ/เสร็จ) และเวลานับถอยหลัง', descEN: 'Real-time kitchen display with order status (Waiting / In-progress / Done) and timers.' },
  { id: 'dashboard',   label: 'Dashboard',               navLabel: 'Dashboard',        descTH: 'แดชบอร์ดสรุปยอด — ยอดขายวันนี้ กราฟรายได้รายชั่วโมง สินค้าขายดี Top-10 และสรุปพนักงาน', descEN: 'Sales overview: daily revenue, hourly chart, top-10 items, and staff performance.' },
  { id: 'bom',         label: 'BOM Builder',             navLabel: 'BOM Builder',      descTH: 'สร้าง Bill of Materials — กำหนดวัตถุดิบ ปริมาณต่อเสิร์ฟ และสูตรสำหรับแต่ละเมนู', descEN: 'Define ingredients, quantities per serving, and recipes for each menu item.' },
  { id: 'inventory',   label: 'Inventory',               navLabel: 'Inventory',        descTH: 'คลังวัตถุดิบ — ดูระดับสต็อก แจ้งเตือนสต็อกต่ำ รับของเข้า และบันทึกของเสีย', descEN: 'Stock management: view levels, low-stock alerts, receive stock, and log wastage.' },
  { id: 'pre-orders',  label: 'Pre-Orders',              navLabel: 'Pre-Orders',       descTH: 'ออเดอร์ล่วงหน้า — ดูและจัดการออเดอร์ที่ลูกค้าจองไว้ พร้อมวันเวลารับและสถานะ', descEN: 'Advance orders: view and manage pre-booked orders with pickup time and status tracking.' },
  { id: 'shopping-list', label: 'Shopping List',         navLabel: 'Shopping List',    descTH: 'รายการสั่งซื้อ — รายการวัตถุดิบที่ต้องสั่งซื้อ คำนวณอัตโนมัติจากสต็อกขั้นต่ำ', descEN: 'Auto-generated purchase list based on current stock vs minimum thresholds.' },
  { id: 'stock-take',  label: 'Stock Take',              navLabel: 'Stock Take',       descTH: 'นับสต็อก — กรอกจำนวนจริงที่นับได้ เปรียบเทียบกับระบบ และสรุปผลต่าง (variance)', descEN: 'Physical count: enter actual quantities, compare with system, and record variance.' },
  { id: 'cash',        label: 'Cash Reconciliation',     navLabel: 'Cash',             descTH: 'ปิดยอดเงินสด — กระทบยอดเงินสดในลิ้นชักกับยอดขาย บันทึก drop และปิดกะ', descEN: 'End-of-shift cash reconciliation: match drawer vs sales, record drops, close shifts.' },
  { id: 'promotions',  label: 'Promotions',              navLabel: 'Promotions',       descTH: 'โปรโมชัน — สร้างและจัดการส่วนลด (บาท/%) โค้ดส่วนลด และโปรแบบ Buy-X-Get-Y', descEN: 'Create and manage discounts (flat/%), coupon codes, and buy-X-get-Y offers.' },
  { id: 'protocols',   label: 'Protocols / SOP',         navLabel: 'Protocols / SOP',  descTH: 'โปรโตคอล — บันทึกขั้นตอนมาตรฐาน (SOP) สำหรับเปิด/ปิดร้าน คุณภาพ และความปลอดภัย', descEN: 'Standard Operating Procedures for opening/closing, quality, and safety.' },
  { id: 'shifts',      label: 'ตารางกะ (Shift Schedule)',navLabel: 'ตารางกะ',          descTH: 'ตารางกะ — วางแผนและดูตารางเวรพนักงานรายสัปดาห์/รายเดือน', descEN: 'Shift scheduler: plan and view weekly/monthly staff rosters.' },
  { id: 'hr',          label: 'HR & Admin',              navLabel: 'HR & Admin',       descTH: 'HR — ข้อมูลพนักงาน บทบาท เวลาเข้า-ออกงาน ลา และ Tasks', descEN: 'Staff profiles, roles, attendance, leave requests, and task tracking.' },
  { id: 'hardware',    label: 'Hardware',                navLabel: 'Hardware',         descTH: 'อุปกรณ์ — ตั้งค่าและทดสอบเครื่องพิมพ์ใบเสร็จ เครื่องสแกน และลิ้นชักเงินสด', descEN: 'Configure and test receipt printers, barcode scanners, and cash drawers.' },
  { id: 'catalog',     label: 'Catalog Admin',           navLabel: 'Catalog',          descTH: 'จัดการเมนู — เพิ่ม/แก้ไข/ลบสินค้า กำหนดราคา หมวดหมู่ modifier groups และตัวเลือก', descEN: 'Menu admin: add/edit/delete items, prices, categories, and modifier groups.' },
  { id: 'customers',   label: 'Customers',               navLabel: 'Customers',        descTH: 'ลูกค้า — ข้อมูลลูกค้าและประวัติออเดอร์ (ฟีเจอร์กำลังพัฒนา)', descEN: 'Customer profiles and order history. (Feature in development)' },
  { id: 'reports',     label: 'Reports',                 navLabel: 'Reports',          descTH: 'รายงาน — รายงานยอดขายรายวัน/รายเดือน ต้นทุน และกำไร (ฟีเจอร์กำลังพัฒนา)', descEN: 'Daily/monthly sales, cost, and profit reports. (Feature in development)' },
  { id: 'settings',    label: 'Settings',                navLabel: 'Settings',         descTH: 'ตั้งค่า — ตั้งค่าระบบทั่วไป ภาษา สกุลเงิน และการแจ้งเตือน (ฟีเจอร์กำลังพัฒนา)', descEN: 'General system settings: language, currency, notifications. (Feature in development)' },
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page    = await context.newPage();

  page.on('console', () => {});
  page.on('pageerror', () => {});

  // Intercept ALL /api/v1/* requests with mock data
  await page.route('**/api/v1/**', handleApiRoute);

  const shots: { screen: ScreenDef; imgPath: string }[] = [];

  // ── 1. Login screen (no token) ─────────────────────────────────────────
  console.log('📸 login');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  const loginFile = join(OUT_DIR, 'login.png');
  await page.screenshot({ path: loginFile, fullPage: false });
  shots.push({ screen: SCREENS[0], imgPath: loginFile });

  // ── 2. Inject fake token ───────────────────────────────────────────────
  await context.addInitScript(() => {
    localStorage.setItem('cafe_pos_token', 'mock-token-for-docs');
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);  // wait for React Query to load data

  // ── 3. Screenshot each screen (fresh reload per screen for clean state) ─
  for (const screen of SCREENS.slice(1)) {
    console.log(`📸 ${screen.id}`);

    // Reload to a clean state with token already injected via addInitScript
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Navigate to target screen via sidebar
    // Use the first significant word as partial-text fallback (handles "/" and "&" edge cases)
    const firstWord = screen.navLabel!.split(/[\s\/&(]/)[0];
    try {
      const btn = page.getByRole('button', { name: screen.navLabel!, exact: true }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
      } else {
        const btn2 = page.locator(`button:has-text("${screen.navLabel!}")`).first();
        if (await btn2.isVisible({ timeout: 2000 })) {
          await btn2.click();
        } else {
          // Partial-text fallback — works even when label has "/" "&" etc.
          await page.locator(`button:has-text("${firstWord}")`).first().click({ timeout: 3000 });
        }
      }
    } catch {
      await page.locator(`button:has-text("${firstWord}")`).first().click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(2000);

    // ── POS: add items to cart ─────────────────────────────────────────────
    if (screen.id === 'pos') {
      for (const itemName of ['ลาเต้', 'อเมริกาโน่ เย็น', 'ครัวซองต์', 'บราวนี่']) {
        await page.locator(`text="${itemName}"`).first().click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(500);
    }

    // ── BOM: select ลาเต้ to show recipe ──────────────────────────────────
    if (screen.id === 'bom') {
      await page.locator('text="ลาเต้"').nth(0).click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Save screenshot as file
    const imgFile = join(OUT_DIR, `${screen.id}.png`);
    await page.screenshot({ path: imgFile, fullPage: false });
    shots.push({ screen, imgPath: imgFile });
  }

  await browser.close();
  console.log(`\n✅ Captured ${shots.length} screens`);

  // ── 4. Build HTML (images referenced as file:// — no base64) ──────────
  console.log('📄 Building HTML…');
  writeFileSync(HTML_OUT, buildHtml(shots), 'utf-8');

  // ── 5. Print to PDF ────────────────────────────────────────────────────
  console.log('📑 Generating PDF…');
  const pdf     = await chromium.launch({ headless: true });
  const pdfPage = await pdf.newPage();
  await pdfPage.goto(`file:///${HTML_OUT.replace(/\\/g, '/')}`, { waitUntil: 'networkidle', timeout: 60000 });
  await pdfPage.pdf({ path: PDF_OUT, format: 'A4', landscape: true, margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' }, printBackground: true });
  await pdf.close();

  console.log(`\n🎉 Done!\n   HTML → ${HTML_OUT}\n   PDF  → ${PDF_OUT}`);
}

function buildHtml(shots: { screen: ScreenDef; imgPath: string }[]) {
  // Use relative paths (HTML is at app/ root, screenshots at app/doc-screenshots/)
  const cards = shots.map(({ screen }, i) => {
    const relPath = `doc-screenshots/${screen.id}.png`;
    return `
<div class="page">
  <div class="page-header">
    <span class="num">${i + 1} / ${shots.length}</span>
    <h2>${screen.label}</h2>
  </div>
  <div class="desc-row">
    <p class="th">${screen.descTH}</p>
    <p class="en">${screen.descEN}</p>
  </div>
  <div class="img-wrap"><img src="${relPath}" alt="${screen.label}"/></div>
</div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8"/><title>POS — Function Reference</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#fff;color:#1a1a1a}
/* A4 landscape content area: 297mm wide × 210mm tall, minus 15mm top/bottom margins = 180mm */
.cover{width:273mm;height:180mm;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#0f3460);color:#fff;page-break-after:always;break-after:page}
.cover h1{font-size:2.4rem;letter-spacing:2px;margin-bottom:10px}.cover .sub{font-size:1.1rem;opacity:.7}.cover .date{margin-top:32px;font-size:.85rem;opacity:.5}
.page{width:273mm;height:180mm;padding:6mm 8mm 6mm 8mm;background:#fff;page-break-after:always;break-after:page;display:flex;flex-direction:column;gap:3mm;overflow:hidden}
.page-header{display:flex;align-items:baseline;gap:10px;border-bottom:2.5px solid #0f3460;padding-bottom:3mm;flex-shrink:0}
.num{font-size:.75rem;color:#888;white-space:nowrap}.page-header h2{font-size:1.3rem;color:#0f3460}
.desc-row{display:flex;gap:16px;flex-shrink:0}
.desc-row p{flex:1;font-size:.78rem;line-height:1.5}
.th{color:#333}.en{color:#666;border-left:2px solid #ddd;padding-left:10px}
.img-wrap{flex:1;min-height:0;border:1px solid #e0e0e0;border-radius:5px;overflow:hidden;background:#fafafa}
.img-wrap img{width:100%;height:100%;object-fit:contain;object-position:top left;display:block}
@media print{.page,.cover{page-break-after:always;break-after:page}}
</style></head><body>
<div class="cover"><h1>POS System</h1><p class="sub">Function Reference — คู่มือฟังก์ชันทั้งหมด</p><p class="date">สร้างเมื่อ ${new Date().toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'})}</p></div>
${cards}
</body></html>`;
}

main().catch(err => { console.error(err); process.exit(1); });
