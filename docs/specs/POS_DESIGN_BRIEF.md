# Cafe POS System — Design Brief

> **วิธีใช้:** เปิด https://claude.ai/design → กด New Project → คัดลอกไฟล์นี้ทั้งไฟล์วาง แล้วบอกว่า "สร้าง prototype web app ตาม brief นี้"

---

## 1. Product Overview

ระบบ Point of Sale (POS) สำหรับธุรกิจ **คาเฟ่ / ร้านกาแฟ / เบเกอรี่ / ร้านชา** ที่ทำงานแบบ "ผลิตตามสั่ง" (made-to-order) เน้น 3 จุดแข็ง:

1. **เร็ว** — รับออเดอร์ได้ภายใน 10 วินาทีในชั่วโมงเร่งด่วน
2. **แม่น** — ตัดสต็อกระดับกรัม/มล. อัตโนมัติผ่าน BOM
3. **ฉลาด** — แปลงข้อมูลขายเป็น insight (menu engineering, forecast, waste reduction)

---

## 2. Target Users & Personas

| Persona | บทบาท | หน้าจอที่ใช้บ่อย |
|---|---|---|
| **บาริสต้า / แคชเชียร์** | รับออเดอร์, รับเงิน | POS Terminal, KDS |
| **เจ้าของร้าน / ผู้จัดการ** | ดู KPI, สั่งวัตถุดิบ, จัดการเมนู | Dashboard, Inventory, Menu Engineering, Reports |
| **เชฟเบเกอรี่** | วางแผนผลิต, เช็คสต็อก | KDS, Inventory, Production Forecast |
| **เจ้าของเชน (multi-store)** | เปรียบเทียบสาขา, โอนสต็อก | Multi-store Dashboard, Transfer |

---

## 3. Design System

### 3.1 Brand Direction
- **Tone:** Professional แต่ warm — สื่อถึงร้านกาแฟ ไม่ใช่ enterprise software แห้งๆ
- **Mood:** Modern, clean, minimal, high-contrast (อ่านง่ายในร้านที่แสงไม่แน่นอน)
- **Inspiration:** Square POS, Toast, Lightspeed — แต่ปรับให้ใช้งานง่ายขึ้นสำหรับร้านไทย

### 3.2 Color Palette
```
Primary (Espresso Brown):   #3D2817
Accent (Caramel):           #D4A574
Background (Cream):         #FAF7F2
Surface (White):            #FFFFFF
Text Primary:               #1A1A1A
Text Secondary:             #6B7280
Success (Matcha):           #5C8A5A
Warning (Honey):            #E8A951
Danger (Berry):             #C24545
Border:                     #E5E0D5
```

### 3.3 Typography
- **Headings:** Inter / Sukhumvit Set (รองรับไทย-อังกฤษ), 600-700 weight
- **Body:** Inter / Sukhumvit Set, 400-500
- **Numbers (price/count):** Tabular nums, 600 weight
- **Sizing:** 12 / 14 / 16 / 20 / 24 / 32 / 48 px

### 3.4 Spacing & Layout
- 8pt grid system
- POS Terminal: ขนาดปุ่มขั้นต่ำ **64×64 px** (touch-friendly)
- Card radius: 12px
- Button radius: 8px

### 3.5 Iconography
- Lucide icons (line style, 1.5px stroke)

---

## 4. Screens (ลำดับความสำคัญ)

### 🟢 P0 — Core (สร้างก่อน)

#### Screen 1: POS Terminal (หน้าหลักรับออเดอร์)
**Layout: Split screen 60/40**

**ซ้าย (60%) — Menu Grid:**
- Tabs ด้านบน: `กาแฟร้อน` `กาแฟเย็น` `ชา` `เบเกอรี่` `อื่นๆ` + ปุ่ม `★ เมนูขายดี`
- Search bar (autocomplete)
- Grid ของเมนู: รูปสินค้า + ชื่อ + ราคา (4 คอลัมน์ tablet, 5-6 คอลัมน์ desktop)
- Hotkey numbers แสดงมุมบนขวาของแต่ละการ์ด

**ขวา (40%) — Cart & Checkout:**
- เลขที่บิล / เลขคิว
- รายการสินค้า (พร้อมแก้จำนวน, ลบ, แก้ modifier)
- Subtotal / Discount / VAT / **Total** (ตัวใหญ่)
- ปุ่ม Action: `เงินสด` `บัตร` `QR PromptPay` `LINE Pay` (icons + text)
- ปุ่มเสริม: `Customer` (ผูกสมาชิก), `Discount`, `Park bill`, `Void`

**Modal: Modifier Selector** (เปิดเมื่อกดเมนูที่ต้องเลือก)
- หัวข้อ: ชื่อเมนู + รูป
- Section "ขนาด *" (required, radio): S / M / L
- Section "นม *" (required): นมสด / นมโอ๊ต (+10) / นมอัลมอนด์ (+15)
- Section "ความหวาน": หวานน้อย / ปกติ / หวานมาก
- Section "เพิ่มเติม" (optional, checkbox): เพิ่มช็อต (+15) / วิปครีม (+10) / มุก (+10)
- Footer: ราคารวมที่อัปเดตเรียลไทม์ + ปุ่ม `เพิ่มลงตะกร้า`

**Modal: Payment - QR Dynamic**
- QR Code ขนาดใหญ่ (สร้างจาก amount)
- ยอดเงิน + ชื่อร้าน
- Status indicator: รอชำระ → ✅ ชำระแล้ว
- ปุ่ม `ยกเลิก` `พิมพ์ใบเสร็จ`

---

#### Screen 2: Kitchen Display System (KDS)
**Layout: Card grid (3-4 คอลัมน์)**

แต่ละการ์ด = 1 ออเดอร์:
- Header: เลขคิว (ใหญ่) + ประเภท (Dine-in/Takeaway/Delivery) + เวลาผ่านไป (หากเกิน 5 นาที = สีเหลือง, เกิน 10 = แดง)
- รายการเครื่องดื่ม/อาหาร พร้อม modifier (เน้นตัวหนา modifier พิเศษ)
- ปุ่ม `Bump` (เริ่มทำ) / `Done` (ส่งมอบ)
- Status badge: New / In Progress / Ready

---

#### Screen 3: Dashboard (หน้าแรกสำหรับเจ้าของร้าน)
**Layout: Grid 12 คอลัมน์**

**Row 1 — KPI Cards (4 ใบ):**
- ยอดขายวันนี้ (พร้อม % เทียบเมื่อวาน)
- จำนวนบิล
- ค่าเฉลี่ยต่อบิล (ATV)
- กำไรขั้นต้น (Gross Profit %)

**Row 2 — Charts:**
- Line chart: ยอดขายรายชั่วโมงวันนี้ vs สัปดาห์ที่แล้ว
- Bar chart: เมนูขายดี Top 10

**Row 3 — Lists:**
- Live orders feed (อัปเดต real-time)
- Low stock alerts
- พนักงานที่กำลัง active

---

### 🟡 P1 — Important

#### Screen 4: Inventory Management
- Tabs: `วัตถุดิบ` `สินค้าสำเร็จ` `BOM (สูตร)` `ส่วนสูญเสีย` `Purchase Orders`
- ตารางวัตถุดิบ: รูป, ชื่อ, หน่วย, สต็อกคงเหลือ, Par level, สถานะ (เขียว/เหลือง/แดง), Action
- ปุ่ม `+ รับเข้าสต็อก`, `บันทึก Wastage`, `สั่งซื้ออัตโนมัติ`

#### Screen 5: BOM Builder (สูตรอาหาร)
- เลือกเมนู → แสดงรายการวัตถุดิบที่ใช้ + ปริมาณ + หน่วย + cost
- คำนวณ **Recipe Cost / Selling Price / Margin %** อัตโนมัติ
- Visual: ภาพเมนู + ingredient list แบบ drag-and-drop

#### Screen 6: Menu Engineering Matrix
- Scatter plot 2 แกน: X = Popularity, Y = Profitability
- 4 quadrants ระบายสี: Stars / Plow Horses / Puzzles / Dogs
- คลิกเมนูในกราฟ → side panel แนะนำ action ("ขึ้นราคา 5 บาท คาดว่ากำไรเพิ่ม X%")
- Filter ตามช่วงเวลา: 7/30/90 วัน

#### Screen 7: Customer / CRM
- ตารางสมาชิก + filter (last visit, total spend, tier)
- รายละเอียดลูกค้า: ประวัติซื้อ, เมนูโปรด, แต้ม, tier
- ปุ่มส่งโปรโมชัน (LINE OA / SMS)

#### Screen 8: Reports
- Tabs: `Sales` `Products` `Customers` `Staff` `Inventory` `Finance`
- Date range picker
- Export: PDF / Excel / CSV
- Comparison view (period vs period)

---

### 🔵 P2 — Nice to have

#### Screen 9: Multi-store Dashboard
- World/map view (ถ้าหลายจังหวัด)
- ตารางเปรียบเทียบสาขา: ยอดขาย, ATV, top staff, top item
- ปุ่ม "Drill-down" ไปแต่ละสาขา
- Inter-store stock transfer wizard

#### Screen 10: Staff Management
- รายชื่อพนักงาน + role + permissions
- KPI per staff (sales/hour, ATV, void count)
- Schedule (gantt-style)
- Time clock

#### Screen 11: Settings
- ข้อมูลร้าน, สาขา, ภาษี, สกุลเงิน
- เครื่องพิมพ์ใบเสร็จ, EDC, QR
- LINE OA, ระบบสมาชิก
- Backup & sync

---

## 5. Reusable Components

| Component | ใช้ที่ไหน | ลักษณะ |
|---|---|---|
| `<MenuCard>` | POS Terminal | รูป + ชื่อ + ราคา + badge ขายดี |
| `<CartLineItem>` | POS, KDS | ชื่อเมนู + modifier + qty + price |
| `<ModifierGroup>` | Modifier modal | radio/checkbox + price diff |
| `<KPICard>` | Dashboard | label + value + delta |
| `<StockBadge>` | Inventory | เขียว/เหลือง/แดง + ตัวเลข |
| `<OrderTicket>` | KDS | การ์ดออเดอร์ + timer |
| `<NumberPad>` | Payment, void | ปุ่มตัวเลข touch-friendly |
| `<QRDisplay>` | Payment | QR + amount + status |
| `<DateRangePicker>` | Reports | preset + custom |
| `<EmptyState>` | ทุกจอ | icon + message + CTA |

---

## 6. Critical User Flows (ต้องทำงานได้จริงใน prototype)

### Flow A: รับออเดอร์ + ชำระเงิน (Happy path)
1. กดเมนู "ลาเต้" → Modifier modal เปิด
2. เลือก M / นมโอ๊ต / หวานน้อย / + เพิ่มช็อต → กดเพิ่มลงตะกร้า
3. ราคาในตะกร้าอัปเดต (75 + 10 + 15 = 100)
4. กด `QR PromptPay` → QR modal เปิด แสดงยอด 100 บาท
5. (จำลอง) คลิก "ชำระแล้ว" → toast "สำเร็จ" + พิมพ์ใบเสร็จ + ออเดอร์ส่งไป KDS
6. หน้าหลักล้างตะกร้า เลขที่บิลขึ้นใหม่

### Flow B: เช็ค menu engineering + ปรับราคา
1. ไป Dashboard → คลิก "Menu Engineering"
2. เห็น scatter plot — คลิกเมนูที่อยู่ใน "Plow Horses"
3. Side panel แสดง: "ขายดีแต่กำไรต่ำ → แนะนำ: ขึ้นราคา 5 บาท หรือลด portion 10%"
4. คลิก "ขึ้นราคา" → modal ยืนยัน → บันทึก

### Flow C: ตัดสต็อก + แจ้งเตือน
1. ขายลาเต้ 10 แก้ว → สต็อกเมล็ดกาแฟลด 180g อัตโนมัติ
2. เมล็ดกาแฟต่ำกว่า par level → toast notification + การ์ดเปลี่ยนเป็นสีเหลืองในหน้า Inventory
3. คลิก "สั่งซื้ออัตโนมัติ" → สร้าง PO ส่งซัพพลายเออร์

---

## 7. Responsive & Device

- **POS Terminal:** Tablet landscape เป็นหลัก (1024×768 ขั้นต่ำ), รองรับ touch
- **Dashboard / Reports:** Desktop เป็นหลัก, รองรับ tablet
- **KDS:** TV/monitor 16:9, อ่านชัดในระยะ 2 เมตร (font ใหญ่)
- **Mobile:** Manager view (ดู KPI + แจ้งเตือน), ไม่ใช่หน้ารับออเดอร์

---

## 8. Visual Style Examples

ขอให้สร้าง prototype ที่มีคุณสมบัติเหล่านี้:

- ✅ Soft shadows (ไม่ harsh)
- ✅ Subtle hover animations (150-200ms ease-out)
- ✅ Loading skeleton ในจุดที่ดึงข้อมูล
- ✅ Empty states สวยๆ (ไม่ใช่แค่ "No data")
- ✅ Error/success toast แบบ slide-in
- ✅ Dark mode (optional แต่มีจะดีมาก)
- ❌ ห้าม: gradient ฉูดฉาด, glassmorphism เกินจำเป็น, emoji ในปุ่ม

---

## 9. Sample Data (ใช้สร้าง prototype)

### Menu (ตัวอย่าง 8 รายการ)
```
1. เอสเปรสโซ        | 55 บาท  | กาแฟร้อน
2. ลาเต้             | 75 บาท  | กาแฟร้อน  ⭐ขายดี
3. คาปูชิโน          | 75 บาท  | กาแฟร้อน
4. อเมริกาโน่ เย็น   | 70 บาท  | กาแฟเย็น  ⭐ขายดี
5. ชาเขียวมัทฉะลาเต้ | 90 บาท  | ชา
6. ครัวซองต์         | 65 บาท  | เบเกอรี่
7. บราวนี่           | 75 บาท  | เบเกอรี่
8. คุกกี้ช็อกชิป     | 45 บาท  | เบเกอรี่
```

### Modifiers
- ขนาด: S (-5), M (0), L (+10)
- นม: นมสด (0), นมโอ๊ต (+10), นมอัลมอนด์ (+15), นมพร่อง (0)
- ความหวาน: ไม่หวาน, น้อย, ปกติ, มาก
- Add-ons: + ช็อต (+15), + วิปครีม (+10), + มุก (+10), + เยลลี่ (+5)

### Sample BOM (ลาเต้ 1 แก้ว)
- เมล็ดกาแฟ: 18 g
- นมสด: 200 ml
- น้ำตาล: 5 g
- แก้ว 16 oz: 1 ใบ
- หลอด: 1 อัน
- ฝา: 1 ใบ
- **Total cost: ~22 บาท → Margin 70.7%**

---

## 10. Deliverables ที่ต้องการจาก Claude Design

1. ✅ Working prototype ของ Screen 1 (POS Terminal) ที่ Flow A ทำงานได้จริง
2. ✅ Dashboard (Screen 3) พร้อม mock chart
3. ✅ KDS (Screen 2) แบบ static
4. ✅ Component library พร้อม documentation
5. ✅ Design tokens (colors, typography, spacing) เป็น CSS variables

หลังจาก prototype P0 เสร็จแล้ว ค่อย iterate ไป P1 ทีละจอ

---

**END OF DESIGN BRIEF**
