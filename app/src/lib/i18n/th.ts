// Thai dictionary — the source of truth for the app's copy.
// `en.ts` is typed against `Messages` (= typeof th), so any key added here that is
// missing from en.ts is a compile error. Keep brand/technical terms (POS, KDS, BOM,
// SOP, QR, LINE, PromptPay) in English in BOTH languages.
//
// Values are plain strings, or functions when a string needs interpolation.
// Do NOT add `as const` — it would freeze each value to a Thai string literal type and
// break en parity.

export const th = {
  // ── Shared / generic ──────────────────────────────────────────────────────
  common: {
    save: 'บันทึก',
    cancel: 'ยกเลิก',
    close: 'ปิด',
    confirm: 'ยืนยัน',
    delete: 'ลบ',
    remove: 'นำออก',
    edit: 'แก้ไข',
    add: 'เพิ่ม',
    back: 'ย้อนกลับ',
    next: 'ถัดไป',
    prev: 'ก่อนหน้า',
    search: 'ค้นหา',
    loading: 'กำลังโหลด...',
    saving: 'กำลังบันทึก...',
    all: 'ทั้งหมด',
    none: 'ไม่มี',
    note: 'หมายเหตุ',
    optional: 'ไม่บังคับ',
    required: 'จำเป็น',
    total: 'รวม',
    today: 'วันนี้',
    print: 'พิมพ์',
    page: 'หน้า',
    of: '/',
  },

  // ── Navigation (sidebar) — keyed by screen id ─────────────────────────────
  nav: {
    pos: 'หน้าขาย (POS)',
    kds: 'ครัว (KDS)',
    dashboard: 'แดชบอร์ด',
    bom: 'สูตรการผลิต (BOM)',
    bakery: 'เบเกอรี่ / ส่วนผสมทำเมนู',
    inventory: 'คลังวัตถุดิบ',
    'pre-orders': 'พรีออเดอร์',
    'shopping-list': 'รายการซื้อของ',
    'stock-take': 'ตรวจนับสต็อก',
    cash: 'เงินสด / กระทบยอด',
    'receipt-copies': 'สำเนาใบเสร็จ',
    promotions: 'โปรโมชัน / สะสมแต้ม',
    members: 'สมาชิก',
    protocols: 'ขั้นตอนมาตรฐาน (SOP)',
    shifts: 'ตารางกะ',
    hr: 'บุคคล & แอดมิน',
    hardware: 'อุปกรณ์ฮาร์ดแวร์',
    customers: 'ลูกค้า (CRM)',
    reports: 'รายงาน',
    catalog: 'แคตตาล็อกสินค้า',
    settings: 'ตั้งค่า',
  },

  // ── Bottom tab bar (mobile) ───────────────────────────────────────────────
  tabs: {
    pos: 'POS',
    kds: 'KDS',
    inventory: 'คลัง',
    dashboard: 'แดชบอร์ด',
    more: 'เพิ่มเติม',
    moreTitle: 'เมนูเพิ่มเติม',
    moreOptions: 'เมนูเพิ่มเติม',
    closeMore: 'ปิดเมนูเพิ่มเติม',
  },

  // ── Roles ─────────────────────────────────────────────────────────────────
  roles: {
    OWNER: 'เจ้าของ',
    MANAGER: 'ผู้จัดการ',
    BARISTA: 'บาริสต้า',
    BAKER: 'เบเกอรี่',
  },

  // ── Sidebar chrome ────────────────────────────────────────────────────────
  sidebar: {
    expand: 'ขยายเมนู',
    collapse: 'ย่อเมนู',
    logout: 'ออกจากระบบ',
  },

  // ── Settings screen ───────────────────────────────────────────────────────
  settings: {
    title: 'ตั้งค่า',
    subtitle: 'ภาษา • ข้อมูลร้าน • อุปกรณ์ • Integration • Backup',
    languageTitle: 'ภาษา',
    languageDesc: 'เลือกภาษาที่แสดงทั้งระบบ มีผลทันทีและจำค่าไว้ในเครื่องนี้',
    thai: 'ไทย',
    english: 'English',
    comingSoon: 'เร็วๆ นี้',
    storeInfoTitle: 'ข้อมูลร้าน',
    storeInfoDesc: 'สาขา ภาษี สกุลเงิน เลขผู้เสียภาษี โลโก้บนใบเสร็จ',
    devicesTitle: 'อุปกรณ์',
    devicesDesc: 'เครื่องพิมพ์ใบเสร็จ EDC QR Generator ระบบ KDS หน้าจอลูกค้า',
    integrationTitle: 'Integration',
    integrationDesc: 'LINE OA, ระบบสมาชิก, GrabFood / LINE MAN, Shopee Food, e-Tax invoice',
    backupTitle: 'Backup & Sync',
    backupDesc: 'สำรองข้อมูลรายวันอัตโนมัติ, ซิงก์หลายสาขา, โหมดออฟไลน์',
  },
};

export type Messages = typeof th;
