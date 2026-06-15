# Cafe POS System — Build Prompt

> **วิธีใช้:** คัดลอก section "MASTER PROMPT" ด้านล่างทั้งหมดวางใน Claude Code / Cursor / Claude.ai เพื่อเริ่มสร้างระบบ POS จริง

---

## วิธีใช้ Prompt นี้

มี 3 แบบให้เลือก:

| แบบ | เมื่อไหร่ใช้ | ความยาว |
|---|---|---|
| **A. Master Prompt** | สร้างใหม่ตั้งแต่ต้น ใช้กับ Claude Code / Cursor | ครบที่สุด |
| **B. MVP Quick Start** | อยาก prototype 1 หน้าเร็วๆ บน Claude.ai/Artifacts | สั้นกระชับ |
| **C. Phase Prompt** | สร้างทีละ phase เมื่อมี base แล้ว | กลาง |

---

## A. MASTER PROMPT (Full Build)

```
คุณกำลังจะสร้างระบบ Point of Sale (POS) สำหรับธุรกิจคาเฟ่ / ร้านกาแฟ / เบเกอรี่
เน้นการใช้งานจริงในร้านไทย รองรับการชำระเงินแบบ PromptPay QR และเชื่อม LINE OA

────────────────────────────────────────────────
🎯 GOAL
────────────────────────────────────────────────
สร้างเว็บแอปพลิเคชัน POS แบบ multi-tenant ที่:
1. รับออเดอร์ได้ภายใน 10 วินาที (touch-optimized)
2. ตัดสต็อกอัตโนมัติผ่าน BOM (Bill of Materials) ระดับกรัม/มล.
3. มี dashboard วิเคราะห์ Menu Engineering + Sales Forecast
4. รองรับหลายสาขา (multi-location)

────────────────────────────────────────────────
🛠 TECH STACK (ห้ามเปลี่ยนโดยไม่ขออนุญาต)
────────────────────────────────────────────────
- Frontend:  Next.js 15 (App Router) + TypeScript
- Styling:   Tailwind CSS + shadcn/ui
- State:     Zustand (client) + TanStack Query (server)
- API:       tRPC v11
- ORM:       Prisma
- Database:  PostgreSQL (Railway)
- Cache:     Redis (Railway) — sessions, rate limit
- Auth:      Auth.js v5 (NextAuth) — credentials provider with PIN
- Realtime:  Pusher Channels (free tier) — สำหรับ KDS
- Storage:   Cloudflare R2 — menu images (10GB free)
- Charts:    Recharts
- Forms:     React Hook Form + Zod
- QR:        promptpay-qr + qrcode
- Testing:   Vitest + Playwright
- Hosting:   Vercel (web) + Railway (DB + Redis)
  ⚠️ Vercel Hobby = no commercial use. Plan migration to Railway full-stack
     before going live with real customers.

────────────────────────────────────────────────
📊 DATA MODEL (Prisma schema — เป็นจุดเริ่มต้น)
────────────────────────────────────────────────

model Tenant {
  id        String   @id @default(cuid())
  name      String
  stores    Store[]
  users     User[]
  createdAt DateTime @default(now())
}

model Store {
  id        String  @id @default(cuid())
  tenantId  String
  tenant    Tenant  @relation(fields: [tenantId], references: [id])
  name      String
  address   String?
  taxId     String?
  orders    Order[]
  inventory InventoryItem[]
  staff     User[]
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  role      Role     // OWNER, MANAGER, BARISTA, BAKER
  pin       String   // 4-6 digit สำหรับ login บน POS
  storeId   String?
  store     Store?   @relation(fields: [storeId], references: [id])
  orders    Order[]  @relation("CreatedBy")
}

model Category {
  id        String   @id @default(cuid())
  name      String
  sortOrder Int
  products  Product[]
}

model Product {
  id           String   @id @default(cuid())
  sku          String   @unique
  name         String
  categoryId   String
  category     Category @relation(fields: [categoryId], references: [id])
  basePrice    Decimal
  imageUrl     String?
  isActive     Boolean  @default(true)
  isFeatured   Boolean  @default(false)
  modifierGroups ProductModifierGroup[]
  recipe       RecipeItem[]
}

model ModifierGroup {
  id          String   @id @default(cuid())
  name        String   // "ขนาด", "นม", "ความหวาน"
  isRequired  Boolean
  minSelect   Int      @default(0)
  maxSelect   Int      @default(1)
  modifiers   Modifier[]
  products    ProductModifierGroup[]
}

model Modifier {
  id              String   @id @default(cuid())
  groupId         String
  group           ModifierGroup @relation(fields: [groupId], references: [id])
  name            String   // "นมโอ๊ต"
  priceDelta      Decimal  @default(0)
  inventoryItemId String?  // ผูกกับวัตถุดิบเพื่อตัดสต็อกเพิ่ม
}

model ProductModifierGroup {
  productId String
  groupId   String
  product   Product @relation(fields: [productId], references: [id])
  group     ModifierGroup @relation(fields: [groupId], references: [id])
  @@id([productId, groupId])
}

model InventoryItem {
  id           String   @id @default(cuid())
  storeId      String
  store        Store    @relation(fields: [storeId], references: [id])
  name         String   // "เมล็ดกาแฟอาราบิก้า"
  unit         String   // g, ml, pcs
  costPerUnit  Decimal
  stockOnHand  Decimal
  parLevel     Decimal  // จุดสั่งซื้อใหม่
  recipeUsage  RecipeItem[]
  movements    StockMovement[]
}

model RecipeItem {
  id            String  @id @default(cuid())
  productId     String
  product       Product @relation(fields: [productId], references: [id])
  inventoryId   String
  inventory     InventoryItem @relation(fields: [inventoryId], references: [id])
  quantity      Decimal // ปริมาณที่ใช้ (เช่น เมล็ด 18g)
  unit          String
}

model StockMovement {
  id          String   @id @default(cuid())
  inventoryId String
  inventory   InventoryItem @relation(fields: [inventoryId], references: [id])
  type        MovementType // RECEIVE, SALE, WASTE, ADJUST, TRANSFER
  quantity    Decimal      // + หรือ -
  reason      String?
  refOrderId  String?
  createdAt   DateTime @default(now())
  createdBy   String
}

model Customer {
  id           String   @id @default(cuid())
  phone        String   @unique
  name         String?
  birthday     DateTime?
  lineUserId   String?
  points       Int      @default(0)
  tier         CustomerTier @default(SILVER)
  totalSpend   Decimal  @default(0)
  visitCount   Int      @default(0)
  orders       Order[]
  createdAt    DateTime @default(now())
}

model Order {
  id           String   @id @default(cuid())
  storeId      String
  store        Store    @relation(fields: [storeId], references: [id])
  orderNumber  String   // คิวที่แสดงให้ลูกค้า
  status       OrderStatus // PENDING, IN_PROGRESS, READY, COMPLETED, VOID
  channel      Channel  // DINE_IN, TAKEAWAY, DELIVERY
  subtotal     Decimal
  discount     Decimal  @default(0)
  tax          Decimal
  total        Decimal
  paidAmount   Decimal  @default(0)
  paymentMethod PaymentMethod?
  customerId   String?
  customer     Customer? @relation(fields: [customerId], references: [id])
  createdById  String
  createdBy    User     @relation("CreatedBy", fields: [createdById], references: [id])
  items        OrderItem[]
  createdAt    DateTime @default(now())
  completedAt  DateTime?
}

model OrderItem {
  id         String   @id @default(cuid())
  orderId    String
  order      Order    @relation(fields: [orderId], references: [id])
  productId  String
  productName String  // snapshot
  quantity   Int
  unitPrice  Decimal
  modifiers  Json     // [{name, priceDelta}]
  notes      String?
  total      Decimal
}

enum Role { OWNER MANAGER BARISTA BAKER }
enum OrderStatus { PENDING IN_PROGRESS READY COMPLETED VOID }
enum Channel { DINE_IN TAKEAWAY DELIVERY }
enum PaymentMethod { CASH CARD QR_PROMPTPAY LINE_PAY TRUEMONEY }
enum MovementType { RECEIVE SALE WASTE ADJUST TRANSFER_IN TRANSFER_OUT }
enum CustomerTier { SILVER GOLD PLATINUM }

────────────────────────────────────────────────
📋 MVP SCOPE (Phase 1 — สร้างให้เสร็จก่อน)
────────────────────────────────────────────────

✅ Auth ด้วย PIN (เร็วบน touch screen) + role-based
✅ POS Terminal Page:
   - Menu grid แยกหมวด + search + featured tab
   - Modifier modal (required/optional, dynamic price)
   - Cart panel + edit/remove/qty
   - Apply discount (% หรือ บาท)
   - Payment: Cash, QR PromptPay (mock), Card (mock EDC)
   - Print receipt (HTML → CSS print)
✅ Order ส่งเข้า KDS realtime
✅ KDS Page: order tickets + bump/done buttons
✅ Inventory CRUD + BOM builder
✅ Auto stock deduction เมื่อ order completed
✅ Low stock alerts (toast + badge)
✅ Manager Dashboard:
   - KPI cards (today sales, orders, ATV, gross profit %)
   - Hourly sales chart
   - Top 10 selling items
✅ Customer CRM: เพิ่ม/ค้นหาด้วยเบอร์, ประวัติซื้อ, แต้ม

────────────────────────────────────────────────
📋 PHASE 2 (ทำหลัง MVP เสถียร)
────────────────────────────────────────────────

⬜ Menu Engineering Matrix (Stars/Plow Horses/Puzzles/Dogs)
⬜ Multi-store dashboard + inter-store transfer
⬜ Sales forecast + staff scheduling suggestion
⬜ Wastage tracking + dynamic happy-hour promotions
⬜ LINE OA integration (loyalty + broadcast)
⬜ Supplier integration + auto purchase orders
⬜ Staff KPI tracking (sales/hour, ATV, voids)
⬜ Reports export (PDF, Excel)

────────────────────────────────────────────────
✅ ACCEPTANCE CRITERIA (ใช้ตรวจสอบงาน)
────────────────────────────────────────────────

# A1: Order flow speed
GIVEN ผู้ใช้อยู่หน้า POS Terminal
WHEN กดเมนูที่มี modifier → เลือก option → ชำระเงินด้วย QR
THEN ขั้นตอนทั้งหมดต้องทำเสร็จได้ภายใน 10 วินาที
AND ใบเสร็จต้องพิมพ์ได้
AND order ต้องไปขึ้นหน้า KDS ภายใน 2 วินาที (realtime)

# A2: BOM stock deduction
GIVEN ลาเต้ 1 แก้วมีสูตร: เมล็ด 18g + นมสด 200ml
AND สต็อกเริ่มต้น: เมล็ด 1000g, นมสด 5000ml
WHEN ขายลาเต้ 5 แก้ว
THEN สต็อกเมล็ดต้องเหลือ 910g
AND สต็อกนมสดต้องเหลือ 4000ml
AND ต้องมี StockMovement records ครบทุกธุรกรรม

# A3: Low stock alert
GIVEN เมล็ดกาแฟมี par level = 200g, สต็อก = 220g
WHEN ขายลาเต้จนสต็อกเหลือ 180g
THEN ต้องมี notification ส่งไปให้ manager
AND การ์ดในหน้า Inventory ต้องเปลี่ยนเป็นสีเหลือง

# A4: Modifier price calculation
GIVEN ลาเต้ ราคา 75
WHEN เลือกขนาด L (+10) + นมโอ๊ต (+10) + เพิ่มช็อต (+15)
THEN ราคาในตะกร้าต้องเป็น 110

# A5: Multi-tenancy isolation
GIVEN มี tenant A และ B
WHEN user ของ A query data
THEN ต้องไม่เห็น data ของ tenant B
AND ทุก query ต้อง filter ด้วย tenantId อัตโนมัติ

────────────────────────────────────────────────
🚀 BUILD ORDER (ทำตามลำดับนี้)
────────────────────────────────────────────────

Step 1: Setup project + Prisma schema + seed data
Step 2: Auth (PIN-based) + middleware
Step 3: Product/Category CRUD + admin pages
Step 4: Modifier system + recipe builder
Step 5: Inventory CRUD + stock movement service
Step 6: POS Terminal UI (read-only mock first)
Step 7: เชื่อม cart → create order → ตัดสต็อก
Step 8: Payment flow + receipt printing
Step 9: KDS page + realtime
Step 10: Manager dashboard + analytics
Step 11: Customer CRM
Step 12: Tests (E2E ของ A1-A5)

────────────────────────────────────────────────
⚠️ CONSTRAINTS & GUIDELINES
────────────────────────────────────────────────

1. **Type safety:** ห้ามใช้ `any` — ถ้าต้อง escape ใช้ `unknown` + type guard
2. **Money:** ใช้ Prisma Decimal เสมอ ห้ามใช้ float
3. **Timezone:** เก็บ UTC ใน DB, แสดง Asia/Bangkok บน UI
4. **i18n:** UI ภาษาไทยเป็นหลัก แต่ใช้ next-intl เพื่อรองรับ EN ได้
5. **Idempotency:** create order ต้องมี idempotencyKey ป้องกันสร้างซ้ำจาก retry
6. **Audit log:** ทุก void / discount / refund ต้องมี log ผู้อนุมัติ
7. **Error handling:** แสดง toast ที่ user friendly ไม่ใช่ stack trace
8. **Performance:** menu grid + KDS ต้องโหลด <300ms (cache aggressively)
9. **Accessibility:** ปุ่มหลักขั้นต่ำ 44×44 px, contrast AA
10. **Security:** rate limit login, hash PIN ด้วย bcrypt, RLS ที่ DB ด้วย

────────────────────────────────────────────────
📁 EXPECTED PROJECT STRUCTURE
────────────────────────────────────────────────

src/
├── app/
│   ├── (auth)/login
│   ├── (pos)/
│   │   ├── terminal       # หน้ารับออเดอร์
│   │   ├── kds            # kitchen display
│   │   └── layout.tsx
│   ├── (admin)/
│   │   ├── dashboard
│   │   ├── inventory
│   │   ├── menu
│   │   ├── customers
│   │   ├── reports
│   │   └── settings
│   └── api/trpc/[trpc]
├── components/
│   ├── ui/                # shadcn primitives
│   ├── pos/               # POS-specific
│   ├── kds/
│   └── charts/
├── server/
│   ├── api/
│   │   ├── routers/       # tRPC routers
│   │   └── trpc.ts
│   ├── services/          # business logic (stock, order, etc)
│   └── db.ts
├── lib/
│   ├── auth.ts
│   ├── format.ts          # currency, date
│   └── validators/        # Zod schemas
├── stores/                # Zustand
└── prisma/
    ├── schema.prisma
    └── seed.ts

────────────────────────────────────────────────
🎬 START
────────────────────────────────────────────────

เริ่มจาก Step 1: Setup project + Prisma schema + seed data
- ใช้ `pnpm` เป็น package manager
- ตั้งชื่อ project: `cafe-pos`
- หลังเขียน schema เสร็จ ให้สร้าง seed data:
  * 1 tenant, 1 store
  * 4 users (owner, manager, 2 baristas) PIN: 1234, 1234, 1111, 2222
  * 5 categories, 8 products พร้อม modifier groups
  * 15 inventory items + recipes ครบทุก product
  * 50 mock orders ย้อนหลัง 30 วัน (สำหรับทดสอบ dashboard)

หลังเสร็จแต่ละ step ให้:
1. รัน type check + test
2. รายงานสั้นๆ ว่าเสร็จอะไร และ next step คืออะไร
3. รอ approval ก่อนไป step ถัดไป

ถ้ามีคำถามก่อนเริ่ม ถามก่อน — ห้าม assume สิ่งที่ไม่ระบุในนี้
```

---

## B. MVP QUICK START (สั้น สำหรับ Claude.ai/Artifacts)

```
สร้างหน้า POS Terminal สำหรับร้านกาแฟ ใช้ React + Tailwind CSS + shadcn/ui

LAYOUT: Split 60/40
ซ้าย (60%) — Menu grid:
  - Tabs: กาแฟร้อน / กาแฟเย็น / ชา / เบเกอรี่
  - Search bar
  - Grid 4 คอลัมน์: รูป + ชื่อ + ราคา
ขวา (40%) — Cart:
  - Order #1234
  - รายการพร้อม +/- qty + ลบ
  - Subtotal / VAT 7% / Total
  - ปุ่ม: เงินสด / บัตร / QR PromptPay

INTERACTIONS:
1. กดเมนู → ถ้ามี modifier เปิด modal เลือก ขนาด/นม/ความหวาน/add-on
2. ราคาคำนวณ realtime ใน modal
3. กดเพิ่มลงตะกร้า → เห็นในขวา
4. กด QR → เปิด modal แสดง QR (mock) + ยอด → ปุ่มยืนยัน → toast สำเร็จ + ล้างตะกร้า

DATA: hardcode 8 เมนู + 4 modifier groups (ขนาด, นม, หวาน, add-on)

DESIGN:
- Color: Espresso brown #3D2817 + Caramel #D4A574 + Cream #FAF7F2
- Touch-friendly (ปุ่มใหญ่ 64px ขั้นต่ำ)
- Tabular nums สำหรับราคา
- ภาษาไทย

ห้าม emoji ในปุ่ม ใช้ Lucide icons แทน
```

---

## C. PHASE PROMPT (ใช้ตอนสร้างทีละ phase)

### C1: เริ่มต้น Phase 1 (MVP)
```
อ่าน POS_BUILD_PROMPT.md (ไฟล์นี้) เริ่มสร้าง MVP ตาม "BUILD ORDER" Step 1-3
รายงานเมื่อเสร็จแต่ละ step และรอ approval
```

### C2: ทำ POS Terminal UI
```
สร้าง POS Terminal page ตาม spec ใน POS_DESIGN_BRIEF.md Screen 1
ใช้ tRPC ดึงข้อมูล menu/category/modifier จาก database
Acceptance: Flow A ใน design brief ต้องทำงานได้จริง (ยัง mock payment ก่อนได้)
```

### C3: เพิ่ม BOM + stock deduction
```
สร้าง service: createOrderWithStockDeduction
- ในหนึ่ง transaction: create order + deduct stock ตาม recipe
- ถ้า stock ไม่พอให้ throw error และ rollback
- บันทึก StockMovement ทุกธุรกรรม
- ทดสอบด้วย acceptance criteria A2 + A3
```

### C4: เพิ่ม Menu Engineering
```
สร้าง /admin/menu-engineering page
1. Query: ยอดขาย + cost ของแต่ละเมนูในช่วง 30 วัน
2. คำนวณ popularity (sales mix %) + profitability (margin %)
3. แสดง scatter plot 4 quadrants ด้วย Recharts
4. Side panel แสดง action recommendation ตาม quadrant
อ้างอิง matrix ใน design brief Section 4 Screen 6
```

---

## D. ปรับ Prompt ให้เหมาะกับเครื่องมือ

| เครื่องมือ | แนะนำให้ใช้ |
|---|---|
| **Claude Code (CLI)** | Master Prompt (A) — ทำงานทีละ step |
| **Cursor** | Master Prompt (A) — paste ใน .cursorrules แล้วใช้ Composer |
| **Claude.ai (chat)** | MVP Quick Start (B) สำหรับ artifact เดียว |
| **claude.ai/design** | ใช้ POS_DESIGN_BRIEF.md (ไฟล์อีกอันหนึ่ง) |
| **v0.dev** | Quick Start (B) — focus UI |
| **Bolt.new** | Master (A) แต่ตัด tRPC ออก ใช้ Next.js Server Actions แทน |

---

## E. คำถามสำคัญที่ต้องตอบก่อนเริ่มสร้างจริง

ก่อน paste prompt ไปสร้างจริง ตอบคำถามเหล่านี้ก่อน:

1. **Hosting:** Self-host (VPS) หรือ Cloud (Vercel + Supabase)?
2. **Tablet:** จะใช้ iPad หรือ Android tablet?
3. **เครื่องพิมพ์ใบเสร็จ:** ยี่ห้อ/รุ่นอะไร? (Star Micronics, Epson?) — กำหนด protocol (ESC/POS, USB/Bluetooth/LAN)
4. **EDC:** ใช้ของธนาคารไหน? (KBank, SCB, Krungsri) — กำหนด integration spec
5. **PromptPay:** มี Tax ID หรือ Mobile? (รูปแบบ payload ต่างกัน)
6. **LINE OA:** มี Channel แล้วหรือยัง? Premium ID?
7. **Multi-store:** เริ่มจาก 1 สาขาก่อน หรือออกแบบ multi-tenant ตั้งแต่แรก?
8. **Offline mode:** จำเป็นไหม? (เพิ่มความซับซ้อนเยอะมาก)
9. **ภาษี:** จดทะเบียน VAT ไหม? ใบกำกับเต็มรูปแบบ?
10. **Budget:** มีงบเท่าไหร่? (จะมีผลกับ stack เช่น Supabase free tier vs paid)

---

**END OF BUILD PROMPT**
