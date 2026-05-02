// Sample data for the prototype
// Menu, modifiers, BOM, KDS orders, dashboard data, inventory data

const MENU = [
  { id: 'm1', name: 'เอสเปรสโซ',           nameEn: 'Espresso',            price: 55, cat: 'hot',     hot: false, color: '#3D2817', tag: 'C1' },
  { id: 'm2', name: 'ลาเต้',                nameEn: 'Latte',               price: 75, cat: 'hot',     hot: true,  color: '#A57854', tag: 'C2', needsModifier: true },
  { id: 'm3', name: 'คาปูชิโน',             nameEn: 'Cappuccino',          price: 75, cat: 'hot',     hot: false, color: '#8B6F47', tag: 'C3', needsModifier: true },
  { id: 'm4', name: 'มอคค่า',               nameEn: 'Mocha',               price: 85, cat: 'hot',     hot: false, color: '#5C3B22', tag: 'C4', needsModifier: true },
  { id: 'm5', name: 'อเมริกาโน่ เย็น',      nameEn: 'Iced Americano',      price: 70, cat: 'cold',    hot: true,  color: '#2A1A0F', tag: 'D1', needsModifier: true },
  { id: 'm6', name: 'ลาเต้ เย็น',           nameEn: 'Iced Latte',          price: 80, cat: 'cold',    hot: false, color: '#B89878', tag: 'D2', needsModifier: true },
  { id: 'm7', name: 'คาราเมล มัคคิอาโต',    nameEn: 'Caramel Macchiato',   price: 95, cat: 'cold',    hot: false, color: '#C49A6E', tag: 'D3', needsModifier: true },
  { id: 'm8', name: 'ชาเขียวมัทฉะลาเต้',    nameEn: 'Matcha Latte',        price: 90, cat: 'tea',     hot: false, color: '#7FA572', tag: 'T1', needsModifier: true },
  { id: 'm9', name: 'ชาไทย เย็น',           nameEn: 'Thai Iced Tea',       price: 65, cat: 'tea',     hot: false, color: '#D88B4E', tag: 'T2', needsModifier: true },
  { id: 'm10', name: 'ชามะนาว',             nameEn: 'Lemon Tea',           price: 55, cat: 'tea',     hot: false, color: '#E8C875', tag: 'T3' },
  { id: 'm11', name: 'ครัวซองต์',           nameEn: 'Croissant',           price: 65, cat: 'bakery',  hot: false, color: '#D9A766', tag: 'B1' },
  { id: 'm12', name: 'บราวนี่',             nameEn: 'Brownie',             price: 75, cat: 'bakery',  hot: false, color: '#4A2C1A', tag: 'B2' },
  { id: 'm13', name: 'คุกกี้ช็อกชิป',       nameEn: 'Choc Chip Cookie',    price: 45, cat: 'bakery',  hot: false, color: '#9A6E3F', tag: 'B3' },
  { id: 'm14', name: 'ชีสเค้ก',             nameEn: 'Cheesecake',          price: 95, cat: 'bakery',  hot: false, color: '#F2DDA4', tag: 'B4' },
  { id: 'm15', name: 'น้ำเปล่า',            nameEn: 'Water',               price: 20, cat: 'other',   hot: false, color: '#9CB7C4', tag: 'O1' },
  { id: 'm16', name: 'โซดามะนาว',           nameEn: 'Lemon Soda',          price: 55, cat: 'other',   hot: false, color: '#B8D58E', tag: 'O2' },
];

const CATEGORIES = [
  { id: 'fav',    label: 'ขายดี',     icon: 'star' },
  { id: 'hot',    label: 'กาแฟร้อน', icon: 'flame' },
  { id: 'cold',   label: 'กาแฟเย็น', icon: 'snowflake' },
  { id: 'tea',    label: 'ชา',        icon: 'leaf' },
  { id: 'bakery', label: 'เบเกอรี่', icon: 'cake' },
  { id: 'other',  label: 'อื่นๆ',     icon: 'dots' },
];

// Modifier groups by item — many drinks share the same set
const STD_DRINK_MODIFIERS = [
  {
    id: 'size', label: 'ขนาด', required: true, type: 'radio',
    options: [
      { id: 's', label: 'S',  diff: -5 },
      { id: 'm', label: 'M',  diff: 0, default: true },
      { id: 'l', label: 'L',  diff: 10 },
    ],
  },
  {
    id: 'milk', label: 'นม', required: true, type: 'radio',
    options: [
      { id: 'fresh',  label: 'นมสด',     diff: 0, default: true },
      { id: 'oat',    label: 'นมโอ๊ต',   diff: 10 },
      { id: 'almond', label: 'นมอัลมอนด์', diff: 15 },
      { id: 'skim',   label: 'นมพร่อง',  diff: 0 },
    ],
  },
  {
    id: 'sweet', label: 'ความหวาน', required: false, type: 'radio',
    options: [
      { id: 'no',  label: 'ไม่หวาน',  diff: 0 },
      { id: 'low', label: 'น้อย',     diff: 0 },
      { id: 'std', label: 'ปกติ',     diff: 0, default: true },
      { id: 'much',label: 'มาก',      diff: 0 },
    ],
  },
  {
    id: 'addons', label: 'เพิ่มเติม', required: false, type: 'check',
    options: [
      { id: 'shot',  label: 'เพิ่มช็อต',   diff: 15 },
      { id: 'whip',  label: 'วิปครีม',     diff: 10 },
      { id: 'pearl', label: 'มุก',         diff: 10 },
      { id: 'jelly', label: 'เยลลี่',     diff: 5  },
    ],
  },
];

// KDS sample tickets
const KDS_TICKETS = [
  {
    id: 'A047', queue: 47, type: 'Dine-in', placedAt: Date.now() - 1000 * 60 * 1, status: 'new',
    items: [
      { name: 'ลาเต้', qty: 1, mods: ['M', 'นมโอ๊ต', 'หวานน้อย', '+ ช็อต'] },
      { name: 'ครัวซองต์', qty: 1, mods: ['อุ่นร้อน'] },
    ],
  },
  {
    id: 'A046', queue: 46, type: 'Takeaway', placedAt: Date.now() - 1000 * 60 * 3, status: 'progress',
    items: [
      { name: 'มัทฉะลาเต้', qty: 2, mods: ['L', 'นมอัลมอนด์', 'หวานน้อย'] },
    ],
  },
  {
    id: 'A045', queue: 45, type: 'Delivery', placedAt: Date.now() - 1000 * 60 * 6, status: 'progress',
    items: [
      { name: 'อเมริกาโน่ เย็น', qty: 1, mods: ['L'] },
      { name: 'มอคค่า',           qty: 1, mods: ['M', 'นมสด', 'วิปครีม'] },
      { name: 'บราวนี่',           qty: 2, mods: [] },
    ],
  },
  {
    id: 'A044', queue: 44, type: 'Dine-in', placedAt: Date.now() - 1000 * 60 * 11, status: 'progress',
    items: [
      { name: 'คาปูชิโน', qty: 3, mods: ['M', 'นมสด'] },
      { name: 'ชาไทย เย็น', qty: 1, mods: ['L'] },
    ],
  },
  {
    id: 'A043', queue: 43, type: 'Takeaway', placedAt: Date.now() - 1000 * 60 * 4, status: 'ready',
    items: [
      { name: 'คาราเมล มัคคิอาโต', qty: 1, mods: ['M', 'หวานน้อย'] },
      { name: 'คุกกี้ช็อกชิป',     qty: 2, mods: [] },
    ],
  },
  {
    id: 'A042', queue: 42, type: 'Dine-in', placedAt: Date.now() - 1000 * 60 * 2, status: 'new',
    items: [
      { name: 'ลาเต้ เย็น', qty: 1, mods: ['L', 'นมโอ๊ต'] },
    ],
  },
];

// Dashboard mock
const DASHBOARD = {
  kpis: [
    { id: 'revenue', label: 'ยอดขายวันนี้',     value: 18420, prefix: '฿', suffix: '',  delta: +12.4, vsLabel: 'เทียบเมื่อวาน' },
    { id: 'orders',  label: 'จำนวนบิล',          value: 184,   prefix: '',  suffix: ' บิล', delta: +8.1,  vsLabel: 'เทียบเมื่อวาน' },
    { id: 'atv',     label: 'ค่าเฉลี่ยต่อบิล',  value: 100,   prefix: '฿', suffix: '',  delta: +3.9,  vsLabel: 'เทียบเมื่อวาน' },
    { id: 'gp',      label: 'กำไรขั้นต้น',      value: 68.4,  prefix: '',  suffix: '%', delta: -1.2, vsLabel: 'เทียบสัปดาห์ก่อน' },
  ],
  // hourly sales today + last week. 8:00 to 20:00
  hours: ['08','09','10','11','12','13','14','15','16','17','18','19','20'],
  today:    [320, 880, 1620, 2180, 2840, 2410, 1480, 1240, 1880, 2160, 940, 320, 150],
  lastWeek: [280, 760, 1450, 1920, 2680, 2120, 1390, 1100, 1560, 1840, 880, 410, 220],
  topItems: [
    { name: 'ลาเต้',               qty: 42, rev: 3150 },
    { name: 'อเมริกาโน่ เย็น',     qty: 31, rev: 2170 },
    { name: 'คาราเมล มัคคิอาโต',   qty: 22, rev: 2090 },
    { name: 'มัทฉะลาเต้',           qty: 18, rev: 1620 },
    { name: 'ครัวซองต์',           qty: 24, rev: 1560 },
    { name: 'มอคค่า',               qty: 16, rev: 1360 },
    { name: 'คาปูชิโน',             qty: 17, rev: 1275 },
    { name: 'บราวนี่',               qty: 14, rev: 1050 },
    { name: 'ชาไทย เย็น',          qty: 12, rev: 780 },
    { name: 'คุกกี้ช็อกชิป',       qty: 13, rev: 585 },
  ],
  liveOrders: [
    { id: 'A047', items: 'ลาเต้, ครัวซองต์',         total: 150, time: '1 นาทีที่แล้ว', status: 'new' },
    { id: 'A046', items: 'มัทฉะลาเต้ x2',              total: 220, time: '3 นาที',         status: 'progress' },
    { id: 'A045', items: 'อเมริกาโน่, มอคค่า, บราวนี่ x2', total: 305, time: '6 นาที', status: 'progress' },
    { id: 'A043', items: 'คาราเมล, คุกกี้ x2',         total: 185, time: '4 นาที',         status: 'ready' },
  ],
  lowStock: [
    { name: 'เมล็ดกาแฟ Arabica',  level: 480,  unit: 'g',  par: 1500, status: 'red' },
    { name: 'นมโอ๊ต Oatside',      level: 2100, unit: 'ml', par: 4000, status: 'yellow' },
    { name: 'แก้ว 16 oz',          level: 38,   unit: 'ใบ', par: 100,  status: 'yellow' },
  ],
  staff: [
    { name: 'แพรว',  role: 'บาริสต้า',   sales: 6240, orders: 64,  initials: 'พ' },
    { name: 'นัท',   role: 'แคชเชียร์',  sales: 5180, orders: 51,  initials: 'น' },
    { name: 'มิ้น',  role: 'บาริสต้า',   sales: 4890, orders: 48,  initials: 'ม' },
    { name: 'ก้อง',  role: 'เชฟเบเกอรี่', sales: 2110, orders: 21,  initials: 'ก' },
  ],
};

// Inventory items (raw materials) — id, name, unit, costPerUnit (THB), stock on hand, parLevel
// Status logic: stock < parLevel*0.5 → red, stock < parLevel → yellow, else → green
const INVENTORY = [
  { id: 'inv-arabica',  name: 'เมล็ดกาแฟ Arabica',     unit: 'g',  costPerUnit: 0.50, stock: 480,   parLevel: 1500 },
  { id: 'inv-robusta',  name: 'เมล็ดกาแฟ Robusta',     unit: 'g',  costPerUnit: 0.30, stock: 1200,  parLevel: 1000 },
  { id: 'inv-milk',     name: 'นมสด',                   unit: 'ml', costPerUnit: 0.06, stock: 8400,  parLevel: 6000 },
  { id: 'inv-oat',      name: 'นมโอ๊ต Oatside',        unit: 'ml', costPerUnit: 0.18, stock: 2100,  parLevel: 4000 },
  { id: 'inv-almond',   name: 'นมอัลมอนด์',             unit: 'ml', costPerUnit: 0.20, stock: 1800,  parLevel: 2000 },
  { id: 'inv-matcha',   name: 'ผงมัทฉะ',                unit: 'g',  costPerUnit: 1.20, stock: 320,   parLevel: 300 },
  { id: 'inv-tea',      name: 'ใบชาดำ',                 unit: 'g',  costPerUnit: 0.40, stock: 850,   parLevel: 500 },
  { id: 'inv-sugar',    name: 'น้ำตาล',                 unit: 'g',  costPerUnit: 0.04, stock: 5200,  parLevel: 3000 },
  { id: 'inv-caramel',  name: 'น้ำเชื่อมคาราเมล',      unit: 'ml', costPerUnit: 0.50, stock: 1600,  parLevel: 1000 },
  { id: 'inv-cocoa',    name: 'ผงโกโก้',                unit: 'g',  costPerUnit: 0.80, stock: 540,   parLevel: 400 },
  { id: 'inv-whip',     name: 'วิปครีม',                unit: 'ml', costPerUnit: 0.30, stock: 980,   parLevel: 800 },
  { id: 'inv-ice',      name: 'น้ำแข็ง',                unit: 'g',  costPerUnit: 0.01, stock: 50000, parLevel: 30000 },
  { id: 'inv-cup-hot',  name: 'แก้วร้อน 12 oz',         unit: 'ใบ', costPerUnit: 2.50, stock: 320,   parLevel: 200 },
  { id: 'inv-cup-cold', name: 'แก้วเย็น 16 oz',         unit: 'ใบ', costPerUnit: 3.00, stock: 38,    parLevel: 100 },
  { id: 'inv-lid',      name: 'ฝาแก้ว',                 unit: 'ใบ', costPerUnit: 0.80, stock: 720,   parLevel: 500 },
  { id: 'inv-straw',    name: 'หลอด',                   unit: 'อัน', costPerUnit: 0.30, stock: 1200,  parLevel: 800 },
  { id: 'inv-croissant',name: 'ครัวซองต์ดิบ (พรีเบค)',  unit: 'ชิ้น', costPerUnit: 18.00, stock: 24,   parLevel: 30 },
  { id: 'inv-brownie',  name: 'บราวนี่ดิบ',             unit: 'ชิ้น', costPerUnit: 22.00, stock: 18,   parLevel: 20 },
  { id: 'inv-cookie',   name: 'คุกกี้ดิบ',              unit: 'ชิ้น', costPerUnit: 12.00, stock: 36,   parLevel: 30 },
  { id: 'inv-cheese',   name: 'ชีสเค้กดิบ',             unit: 'ชิ้น', costPerUnit: 35.00, stock: 8,    parLevel: 20 },
  { id: 'inv-soda',     name: 'โซดา',                   unit: 'ml', costPerUnit: 0.04, stock: 4200,  parLevel: 3000 },
  { id: 'inv-lemon',    name: 'น้ำมะนาวคั้น',           unit: 'ml', costPerUnit: 0.35, stock: 580,   parLevel: 800 },
];

// Wastage reasons (mirrors backend StockMovement.reason enum)
const WASTAGE_REASONS = [
  { id: 'EXPIRED', label: 'หมดอายุ' },
  { id: 'SPILLED', label: 'หก' },
  { id: 'TRIAL',   label: 'ทดลอง' },
  { id: 'DAMAGED', label: 'เสีย' },
  { id: 'OTHER',   label: 'อื่นๆ' },
];

// Sample stock movements — append-only audit log (RECEIVE / WASTE / SALE / ADJUST)
// Mirrors backend StockMovement model. Newest first when displayed.
const STOCK_MOVEMENTS = [
  { id: 'mv1', type: 'RECEIVE', invId: 'inv-arabica',  qty: 1000, costPerUnit: 0.50, supplier: 'กาแฟดอยช้าง',         user: 'แพรว ส.', note: 'รับเข้าประจำสัปดาห์',          at: Date.now() - 86400000 * 2 },
  { id: 'mv2', type: 'RECEIVE', invId: 'inv-milk',     qty: 5000, costPerUnit: 0.06, supplier: 'CP Fresh Milk',          user: 'แพรว ส.', note: '',                              at: Date.now() - 86400000 * 1 },
  { id: 'mv3', type: 'RECEIVE', invId: 'inv-cup-cold', qty: 200,  costPerUnit: 3.00, supplier: 'ทรัพย์เจริญแก้วพลาสติก', user: 'มิ้น ก.', note: 'จัดส่งช้ากว่าปกติ 1 วัน',     at: Date.now() - 86400000 * 5 },
  { id: 'mv4', type: 'WASTE',   invId: 'inv-milk',     qty: 200,  reason: 'EXPIRED', user: 'แพรว ส.', note: 'เปิดทิ้งค้างคืน',                                                  at: Date.now() - 86400000 * 1 },
  { id: 'mv5', type: 'WASTE',   invId: 'inv-croissant',qty: 2,    reason: 'TRIAL',   user: 'นัท ก.',  note: 'อบทดสอบสูตรใหม่',                                                  at: Date.now() - 86400000 * 3 },
  { id: 'mv6', type: 'WASTE',   invId: 'inv-arabica',  qty: 30,   reason: 'SPILLED', user: 'มิ้น ก.', note: 'หกขณะชง',                                                          at: Date.now() - 3600000 * 5 },
];

// Recipes: menu_id -> [{ invId, qty }]  — quantity is in inventory item's unit
const RECIPES = {
  m1: [ // เอสเปรสโซ
    { invId: 'inv-arabica', qty: 18 },
    { invId: 'inv-cup-hot', qty: 1 },
  ],
  m2: [ // ลาเต้
    { invId: 'inv-arabica', qty: 18 },
    { invId: 'inv-milk',    qty: 200 },
    { invId: 'inv-cup-hot', qty: 1 },
    { invId: 'inv-sugar',   qty: 5 },
  ],
  m3: [ // คาปูชิโน
    { invId: 'inv-arabica', qty: 18 },
    { invId: 'inv-milk',    qty: 150 },
    { invId: 'inv-cup-hot', qty: 1 },
  ],
  m4: [ // มอคค่า
    { invId: 'inv-arabica', qty: 18 },
    { invId: 'inv-milk',    qty: 200 },
    { invId: 'inv-cocoa',   qty: 10 },
    { invId: 'inv-whip',    qty: 20 },
    { invId: 'inv-cup-hot', qty: 1 },
  ],
  m5: [ // อเมริกาโน่ เย็น
    { invId: 'inv-arabica',  qty: 18 },
    { invId: 'inv-ice',      qty: 200 },
    { invId: 'inv-cup-cold', qty: 1 },
    { invId: 'inv-lid',      qty: 1 },
    { invId: 'inv-straw',    qty: 1 },
  ],
  m6: [ // ลาเต้ เย็น
    { invId: 'inv-arabica',  qty: 18 },
    { invId: 'inv-milk',     qty: 180 },
    { invId: 'inv-ice',      qty: 150 },
    { invId: 'inv-cup-cold', qty: 1 },
    { invId: 'inv-lid',      qty: 1 },
    { invId: 'inv-straw',    qty: 1 },
  ],
  m7: [ // คาราเมล มัคคิอาโต
    { invId: 'inv-arabica',  qty: 18 },
    { invId: 'inv-milk',     qty: 200 },
    { invId: 'inv-caramel',  qty: 30 },
    { invId: 'inv-ice',      qty: 150 },
    { invId: 'inv-cup-cold', qty: 1 },
    { invId: 'inv-lid',      qty: 1 },
    { invId: 'inv-straw',    qty: 1 },
  ],
  m8: [ // มัทฉะลาเต้
    { invId: 'inv-matcha',   qty: 10 },
    { invId: 'inv-milk',     qty: 200 },
    { invId: 'inv-ice',      qty: 150 },
    { invId: 'inv-cup-cold', qty: 1 },
    { invId: 'inv-lid',      qty: 1 },
    { invId: 'inv-straw',    qty: 1 },
  ],
  m9: [ // ชาไทยเย็น
    { invId: 'inv-tea',      qty: 8 },
    { invId: 'inv-milk',     qty: 100 },
    { invId: 'inv-sugar',    qty: 15 },
    { invId: 'inv-ice',      qty: 150 },
    { invId: 'inv-cup-cold', qty: 1 },
    { invId: 'inv-lid',      qty: 1 },
    { invId: 'inv-straw',    qty: 1 },
  ],
  m10: [ // ชามะนาว
    { invId: 'inv-tea',      qty: 8 },
    { invId: 'inv-lemon',    qty: 20 },
    { invId: 'inv-sugar',    qty: 10 },
    { invId: 'inv-ice',      qty: 150 },
    { invId: 'inv-cup-cold', qty: 1 },
    { invId: 'inv-lid',      qty: 1 },
    { invId: 'inv-straw',    qty: 1 },
  ],
  m11: [ // ครัวซองต์
    { invId: 'inv-croissant', qty: 1 },
  ],
  m12: [ // บราวนี่
    { invId: 'inv-brownie',   qty: 1 },
  ],
  m13: [ // คุกกี้ช็อกชิป
    { invId: 'inv-cookie',    qty: 1 },
  ],
  m14: [ // ชีสเค้ก
    { invId: 'inv-cheese',    qty: 1 },
  ],
  m15: [], // น้ำเปล่า — ขายตรง ไม่ผ่านสูตร
  m16: [ // โซดามะนาว
    { invId: 'inv-soda',     qty: 200 },
    { invId: 'inv-lemon',    qty: 25 },
    { invId: 'inv-sugar',    qty: 10 },
    { invId: 'inv-ice',      qty: 150 },
    { invId: 'inv-cup-cold', qty: 1 },
    { invId: 'inv-lid',      qty: 1 },
    { invId: 'inv-straw',    qty: 1 },
  ],
};

window.MENU = MENU;
window.CATEGORIES = CATEGORIES;
window.STD_DRINK_MODIFIERS = STD_DRINK_MODIFIERS;
window.KDS_TICKETS = KDS_TICKETS;
window.DASHBOARD = DASHBOARD;
window.INVENTORY = INVENTORY;
window.RECIPES = RECIPES;
window.WASTAGE_REASONS = WASTAGE_REASONS;
window.STOCK_MOVEMENTS = STOCK_MOVEMENTS;
