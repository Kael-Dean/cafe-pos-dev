# Backend Handoff — Inventory & Dashboard Features
**วันที่:** 2026-05-03  
**Frontend ทำเสร็จแล้ว** | **Backend ต้องทำ** ตามรายการด้านล่าง

---

## สรุปภาพรวม

Frontend ได้เพิ่ม 3 ฟีเจอร์ใหม่ในหน้า Inventory:
1. **ลบวัตถุดิบ** — ปุ่ม Delete พร้อม confirm modal
2. **Usage Dashboard** — แดชบอร์ดอัตราการใช้วัตถุดิบ (7 วัน / เดือนนี้)
3. **Expiry Date** — แสดงวันหมดอายุในตาราง พร้อมสัญลักษณ์เตือน ≤ 7 วัน

---

## ฟีเจอร์ 1: ลบวัตถุดิบ (Soft Delete)

### Frontend เรียก
```
DELETE /api/v1/inventory/{item_id}
```

### สถานะ Backend ✅ เสร็จแล้ว
- Endpoint `DELETE /api/v1/inventory/{item_id}` มีอยู่แล้ว (soft-delete ตั้ง `is_active = False`)
- Permission: `OWNER` / `MANAGER` เท่านั้น
- **ไม่ต้องแก้อะไร**

---

## ฟีเจอร์ 2: Usage Dashboard (อัตราการใช้วัตถุดิบ)

### ทำงานอย่างไร
Frontend ดึง movements จาก `/api/v1/inventory/movements?limit=200` แล้วกรอง `type = "SALE"` มาคำนวณปริมาณที่ใช้แต่ละรายการใน 7 วัน / เดือนนี้

### ปัญหาตอนนี้ ⚠️
**ยังไม่มี SALE movements ในฐานข้อมูล** → Usage tab แสดง "ยังไม่มีข้อมูลการใช้งาน"

### Backend ต้องทำ

#### 2A — สร้าง SALE movements เมื่อออเดอร์เสร็จ

เมื่อออเดอร์ถูก complete (`status = "PAID"` หรือ `"COMPLETED"`) ให้:
1. วน loop แต่ละรายการใน order (`OrderItem`)
2. ดึง BOM ของ product นั้น (`BOMItem` records)
3. สร้าง `StockMovement` type=SALE สำหรับแต่ละ ingredient ที่ใช้

```python
# ตัวอย่าง logic ใน service layer
async def deduct_inventory_for_order(
    db: AsyncSession,
    *,
    store_id: str,
    order_id: str,
    order_items: list[OrderItemRead],
    cashier_user_id: str,
) -> None:
    for oi in order_items:
        bom_items = await bom.get_bom_for_product(db, product_id=oi.product_id)
        for bom_item in bom_items:
            qty_used = bom_item.quantity * oi.qty
            inv_item = await _load_item(db, store_id=store_id, item_id=bom_item.inventory_item_id)
            inv_item.stock_on_hand -= qty_used
            db.add(StockMovement(
                store_id=store_id,
                inventory_item_id=bom_item.inventory_item_id,
                type=MovementType.SALE,
                quantity=qty_used,
                ref_order_id=order_id,
                created_by_id=cashier_user_id,
            ))
```

**เรียกใช้จาก:** order complete endpoint (ตอนที่เปลี่ยน status เป็น PAID/COMPLETED)

#### 2B — (Optional) เพิ่ม Usage Stats endpoint

ถ้า frontend มีปัญหาเรื่อง performance (items เยอะมาก) ให้เพิ่ม endpoint:

```
GET /api/v1/inventory/usage-stats?period=week|month
```

Response:
```json
[
  {
    "inventory_item_id": "cuid...",
    "name": "นมสด",
    "unit": "ml",
    "total_qty": 15000.0
  }
]
```

Query ใช้ SQL GROUP BY บน `stock_movements` filter `type = 'SALE'` และ `created_at >= period_start`

---

## ฟีเจอร์ 3: Expiry Date

### Frontend เรียก

**สร้างวัตถุดิบพร้อม expiry date:**
```
POST /api/v1/inventory
{
  "name": "นมสด",
  "unit": "ml",
  "par_level": 5000,
  "cost_per_unit": 0.05,
  "expiry_date": "2026-06-01"
}
```

**อัปเดต expiry date:**
```
PATCH /api/v1/inventory/{item_id}
{
  "expiry_date": "2026-07-15"
}
```

### สถานะ Backend ✅ เสร็จแล้ว
- `expiry_date` คอลัมน์มีใน `InventoryItem` model แล้ว (type `Date`, nullable)
- `InventoryItemCreate` และ `InventoryItemUpdate` schema มี field นี้แล้ว
- `InventoryItemRead` return `expiry_date` กลับให้ frontend แล้ว
- `create_item()` และ `update_item()` service บันทึก field นี้แล้ว

> ⚠️ **ตรวจสอบ Migration:** ถ้า database ยังไม่มีคอลัมน์ `expiry_date` ใน table `inventory_items` ให้รัน migration ก่อน

```bash
alembic revision --autogenerate -m "add expiry_date to inventory_items"
alembic upgrade head
```

หรือ SQL โดยตรง:
```sql
ALTER TABLE inventory_items ADD COLUMN expiry_date DATE;
```

---

## Response Shape ที่ Frontend Expect

### `GET /api/v1/inventory`
```json
[
  {
    "id": "cuid...",
    "name": "นมสด",
    "unit": "ml",
    "cost_per_unit": "0.0500",
    "stock_on_hand": "4500.000",
    "par_level": "5000.000",
    "is_active": true,
    "status": "low",
    "expiry_date": "2026-06-01"
  }
]
```

### `GET /api/v1/inventory/movements`
```json
{
  "items": [
    {
      "id": "...",
      "type": "SALE",
      "inventory_item_id": "...",
      "quantity": "250.000",
      "reason_code": null,
      "note": null,
      "supplier": null,
      "created_by": { "id": "...", "name": "สมชาย" },
      "created_at": "2026-05-03T10:30:00Z"
    }
  ],
  "next_cursor": null
}
```

---

---

## ฟีเจอร์ 4: HR Module (พนักงาน)

### ภาพรวม
Dashboard หน้า "พนักงาน" ตอนนี้ใช้ `/api/v1/reports/cashier-shifts` แสดงชื่อ + ยอดขาย + จำนวนบิลของแต่ละคนในวันนี้ได้แล้ว **ยังขาด** module จัดการพนักงาน (HR) ที่ frontend hooks เรียกอยู่แต่ backend ยังไม่มี

### Endpoints ที่ Frontend ต้องการ

```
GET    /api/v1/hr/staff                  รายชื่อพนักงานทั้งหมดในร้าน
POST   /api/v1/hr/staff                  เพิ่มพนักงานใหม่
PATCH  /api/v1/hr/staff/{user_id}        แก้ไขข้อมูลพนักงาน (role, name)
DELETE /api/v1/hr/staff/{user_id}        ปิดใช้งานพนักงาน (soft-delete)

GET    /api/v1/hr/leaves                 ดูใบลาทั้งหมด (MANAGER+ เท่านั้น)
GET    /api/v1/hr/leaves/mine            ดูใบลาของตัวเอง
POST   /api/v1/hr/leaves                 ยื่นใบลา
PATCH  /api/v1/hr/leaves/{id}/review     อนุมัติ/ปฏิเสธใบลา (MANAGER+ เท่านั้น)

GET    /api/v1/hr/shifts?week_start=YYYY-MM-DD   ดูตารางกะรายสัปดาห์
POST   /api/v1/hr/shifts                          กำหนดกะ (MANAGER+ เท่านั้น)
```

### Schemas ที่ Frontend Expect

#### `GET /api/v1/hr/staff`
```json
[
  {
    "id": "cuid...",
    "name": "แพรว สมใจ",
    "role": "BARISTA"
  }
]
```
roles ที่รองรับ: `OWNER | MANAGER | BARISTA | BAKER`

#### `GET /api/v1/hr/leaves`
```json
[
  {
    "id": "cuid...",
    "store_id": "...",
    "user_id": "...",
    "user_name": "แพรว สมใจ",
    "start_date": "2026-05-10",
    "end_date": "2026-05-11",
    "leave_type": "SICK",
    "status": "PENDING",
    "note": "ไข้",
    "reviewed_by_id": null,
    "reviewed_at": null,
    "created_at": "2026-05-03T08:00:00Z",
    "updated_at": "2026-05-03T08:00:00Z"
  }
]
```
leave_type: `VACATION | SICK | PERSONAL | OTHER`  
status: `PENDING | APPROVED | REJECTED`

#### `GET /api/v1/hr/shifts?week_start=2026-05-05`
```json
[
  {
    "id": "cuid...",
    "store_id": "...",
    "user_id": "...",
    "user_name": "แพรว สมใจ",
    "assignment_date": "2026-05-05",
    "shift_type": "MORNING",
    "notes": null,
    "created_by_id": "...",
    "created_at": "2026-05-03T08:00:00Z",
    "updated_at": "2026-05-03T08:00:00Z"
  }
]
```
shift_type: `MORNING | AFTERNOON | EVENING | FULL_DAY | OFF`

### แนะนำ Implementation

1. สร้าง `api/app/api/v1/hr.py` — FastAPI router
2. สร้าง `api/app/schemas/hr.py` — Pydantic schemas (LeaveRequest, ShiftAssignment)
3. สร้าง `api/app/models/hr.py` (หรือใส่ใน identity.py) — LeaveRequest + ShiftAssignment tables
4. สร้าง `api/app/services/hr.py` — CRUD logic
5. Register ใน `api/app/api/v1/router.py`:
   ```python
   from app.api.v1 import hr
   api_router.include_router(hr.router)
   ```
6. รัน Alembic migration

### Permission
- ดูพนักงาน/ยื่นใบลา/ดูตารางกะ: `StoreUser` (ทุก role)
- เพิ่ม/แก้ไข/ลบพนักงาน / อนุมัติใบลา / กำหนดกะ: `MANAGER` + `OWNER`

---

## Priority

| # | งาน | ความสำคัญ | ประมาณเวลา |
|---|-----|-----------|------------|
| 1 | ตรวจ / รัน Alembic migration สำหรับ `expiry_date` | 🔴 สูงมาก | 5 นาที |
| 2 | สร้าง SALE movements เมื่อ order complete | 🔴 สูงมาก | 2–4 ชั่วโมง |
| 3 | HR Module (`/api/v1/hr/*`) | 🟠 สูง | 4–6 ชั่วโมง |
| 4 | Usage Stats endpoint (optional, performance) | 🟡 ปานกลาง | 1 ชั่วโมง |

---

## ไฟล์ Backend ที่เกี่ยวข้อง

```
api/app/models/inventory.py       ← InventoryItem, StockMovement models
api/app/schemas/inventory.py      ← Pydantic schemas (ครบแล้ว)
api/app/services/inventory.py     ← เพิ่ม deduct_inventory_for_order() ที่นี่
api/app/api/v1/inventory.py       ← API routes (ครบแล้ว)
api/app/services/order.py         ← เรียก deduct_inventory_for_order() จากที่นี่
alembic/versions/                 ← เพิ่ม migration ถ้ายังไม่มี expiry_date
```
