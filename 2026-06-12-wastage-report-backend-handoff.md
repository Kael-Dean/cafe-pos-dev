# Backend Handoff — Wastage Report API (full detail)

**Date:** 2026-06-12
**For:** Backend dev (caf-pos-repo-dev / FastAPI → Railway)
**Requested by:** owner (frontend already built to this contract)

---

## TL;DR

Frontend ทำหน้า **"รายงานของเสีย"** (waste report) แบบเดียวกับรายงานยอดขาย — daily/range toggle, summary cards, breakdown tables, per-event register, ดาวน์โหลด Excel.

Endpoint `GET /api/v1/reports/wastage` **มีอยู่แล้ว** แต่คืนแค่ `by_reason` + totals. ต้อง **เพิ่ม 4 ส่วน** (additive, backward-compatible):
1. `event_count` (total)
2. `by_day[]` — รายวัน
3. `by_item[]` — แยกตามวัตถุดิบ
4. `events[]` — รายการของเสียทุกครั้ง (register)

**ไม่ต้องทำ migration** (ข้อมูลอยู่ใน `stock_movements` อยู่แล้ว). **Role gating เดิม** (`MANAGER`+) ใช้ต่อได้.

---

## Current state

`app/api/v1/reports.py` → `get_wastage_report` (เส้นทาง `/reports/wastage?from=&to=`, gated `_MANAGER_PLUS`).

`app/services/reports.py:251` `get_wastage_report()` คืน:
```python
WastageReportRead(from_, to, by_reason=[...], total_quantity, total_cost)
```
- aggregate: `StockMovement` where `type == WASTE` and `created_at` in `[from_, to]`, join `InventoryItem`.
- reason เก็บเป็น `"<CODE>|<note>"` → ใช้ `split_part(reason, '|', 1)` ดึง code.
- cost = `Σ abs(quantity) * InventoryItem.cost_per_unit` (movement.unit_cost เป็น NULL สำหรับ waste — ดู "Cost note").

## Data available (ไม่ต้องเพิ่ม column)

`StockMovement` (`app/models/inventory.py:43`):
| field | type | หมายเหตุ |
|---|---|---|
| `id` | str(24) | |
| `inventory_item_id` | str(24) | → join `InventoryItem` (name, unit, cost_per_unit) |
| `type` | MovementType | filter `== WASTE` |
| `quantity` | Numeric(12,3) | เป็นบวกสำหรับ waste |
| `reason` | Text | `"<WastageReason>|<note>"` (`_encode_waste_reason`) |
| `unit_cost` | Numeric(12,4) | **NULL สำหรับ waste** (ดู Cost note) |
| `created_by_id` | str(24) | → join `User.name` |
| `created_at` | datetime | index `ix_movements_store_created (store_id, created_at)` |

Reason decode helper มีแล้ว: `app/services/inventory.py:343 _decode_movement_reason(type, raw) -> (reason_code, note, supplier, raw)`.
`WastageReason` = `EXPIRED | SPILLED | TRIAL | DAMAGED | OTHER` (`app/enums.py:27`).

---

## Required: extend `app/schemas/reports.py`

เก็บ `WastageByReason` เดิมไว้. เพิ่ม:

```python
class WastageByReason(BaseModel):       # มีอยู่แล้ว
    reason_code: str
    event_count: int
    total_quantity: Decimal
    estimated_cost: Decimal


class WastageByDay(BaseModel):          # NEW
    bucket: str                         # "YYYY-MM-DD"
    event_count: int
    total_quantity: Decimal
    estimated_cost: Decimal


class WastageByItem(BaseModel):         # NEW
    item_id: str
    item_name: str
    unit: str
    event_count: int
    total_quantity: Decimal
    estimated_cost: Decimal


class WastageEvent(BaseModel):          # NEW — one row per waste movement
    id: str
    created_at: datetime
    item_name: str
    unit: str
    quantity: Decimal
    reason_code: str                    # decoded; "OTHER" if unknown/missing
    note: str | None
    created_by_name: str
    estimated_cost: Decimal             # abs(quantity) * cost_per_unit


class WastageReportRead(BaseModel):
    from_: datetime
    to: datetime
    total_quantity: Decimal
    total_cost: Decimal
    event_count: int                    # NEW
    by_reason: list[WastageByReason]
    by_day: list[WastageByDay]          # NEW
    by_item: list[WastageByItem]        # NEW
    events: list[WastageEvent]          # NEW (chronological ASC by created_at)
```

> Field ใหม่ทั้งหมดเป็น additive — ของเดิมที่ใช้ `by_reason`/totals ไม่พัง.

---

## Required: extend `app/services/reports.py:get_wastage_report`

ใช้ base filter เดิม ทุก query:
```python
base = and_(
    StockMovement.store_id == store_id,
    StockMovement.type == MovementType.WASTE,
    StockMovement.created_at >= from_,
    StockMovement.created_at <= to,
)
reason_code_expr = func.coalesce(
    func.nullif(func.split_part(StockMovement.reason, "|", 1), ""), "OTHER"
)
cost_expr = func.abs(StockMovement.quantity) * InventoryItem.cost_per_unit
qty_expr  = func.abs(StockMovement.quantity)
```

**1) by_reason** — เดิม (group by `reason_code_expr`).

**2) by_day** — group by วัน:
```python
day_expr = func.date_trunc("day", StockMovement.created_at)
rows = await db.execute(
    select(
        day_expr.label("bucket"),
        func.count(StockMovement.id).label("event_count"),
        func.sum(qty_expr).label("total_quantity"),
        func.sum(cost_expr).label("estimated_cost"),
    )
    .join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
    .where(base).group_by(day_expr).order_by(day_expr)
)
# bucket=r.bucket.strftime("%Y-%m-%d")
```

**3) by_item** — group by วัตถุดิบ, order มูลค่ามาก→น้อย:
```python
select(
    InventoryItem.id.label("item_id"),
    InventoryItem.name.label("item_name"),
    InventoryItem.unit.label("unit"),
    func.count(StockMovement.id).label("event_count"),
    func.sum(qty_expr).label("total_quantity"),
    func.sum(cost_expr).label("estimated_cost"),
).join(InventoryItem, ...).where(base)
 .group_by(InventoryItem.id, InventoryItem.name, InventoryItem.unit)
 .order_by(func.sum(cost_expr).desc())
```

**4) events** — register รายครั้ง, join User, order `created_at` ASC:
```python
select(
    StockMovement.id, StockMovement.created_at, StockMovement.quantity,
    StockMovement.reason,
    InventoryItem.name, InventoryItem.unit, InventoryItem.cost_per_unit,
    User.name.label("created_by_name"),
).join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
 .join(User, User.id == StockMovement.created_by_id)
 .where(base).order_by(StockMovement.created_at.asc(), StockMovement.id.asc())
```
ต่อแถว: `reason_code, note = _decode_movement_reason(WASTE, row.reason)[:2]` (code = `"OTHER"` ถ้า None), `estimated_cost = abs(quantity) * cost_per_unit`.
ไม่ต้อง paginate — ปริมาณ waste ต่ำ. (ถ้ากังวลช่วงยาวมาก ใส่ cap เช่น 5000 ได้ แต่ default คืนทั้งหมด)

**totals**: `total_quantity` / `total_cost` = ผลรวมจาก by_reason (เดิม). `event_count` = `sum(b.event_count for b in by_reason)` หรือ `func.count` แยกอีกครั้ง — ค่าตรงกัน.

---

## Cost note (สำคัญ)

`record_waste` (`inventory.py:125`) **ไม่ snapshot `unit_cost`** ตอนบันทึก → `movement.unit_cost` เป็น NULL. ทุก cost ในรายงานจึง **ประมาณจาก `InventoryItem.cost_per_unit` ปัจจุบัน** (เหมือน `get_wastage_report`/`get_cogs_report` ที่ทำอยู่). ถ้า cost วัตถุดิบเปลี่ยนทีหลัง มูลค่าของเสียย้อนหลังจะคิดด้วย cost ใหม่.

**(Optional, ไม่บังคับ)** อยากให้แม่นย้อนหลัง → ตอน `record_waste` set `unit_cost=item.cost_per_unit` ลง movement, แล้ว report ใช้ `coalesce(StockMovement.unit_cost, InventoryItem.cost_per_unit)`. ทำเป็น enhancement แยกได้ — frontend ไม่ต้องแก้.

---

## Acceptance

- `GET /api/v1/reports/wastage?from=<ISO>&to=<ISO>` (MANAGER/OWNER) คืน schema ด้านบนครบทุก field.
- ช่วงไม่มีของเสีย → ทุก array = `[]`, totals/`event_count` = 0 (ไม่ใช่ null/500).
- `events` เรียง created_at น้อย→มาก; `reason_code` เป็นหนึ่งใน WastageReason หรือ `"OTHER"`.
- store อื่นไม่ปนกัน (filter ด้วย `store_id` จาก JWT — เป็นมาตรฐาน repo อยู่แล้ว).

### Tests (มี pattern อยู่แล้ว)
`tests/conftest.py` + `tests/factories.py` (`make_item`, `make_user`). บันทึก waste ผ่าน `inv.record_waste(...)` หลายเหตุผล/หลายวัน/หลายวัตถุดิบ แล้ว assert:
- `by_reason` / `by_item` / `by_day` รวม quantity & cost ถูก
- `len(events) == จำนวน movement`, ค่าใน event ตรง (reason_code/note decode, estimated_cost)
- `event_count` = ผลรวม
ดู `tests/test_inventory_*` เป็นต้นแบบ. ต้องใช้ Postgres จริง (เหมือน suite เดิม).

---

## Frontend contract (FYI)

Frontend อ่าน field ตามชื่อด้านบนตรง ๆ:
- hook: `app/src/hooks/use-wastage-report.ts`
- จอ: `WasteReport` ใน `app/src/components/screens/reports.tsx`
- Excel: `app/src/lib/wastage-report-xlsx.ts`

FE สร้างไว้แบบ **tolerant**: ถ้า BE ยังไม่ส่ง `by_day`/`by_item`/`events` (deploy ยังไม่ขึ้น) จะ default เป็น `[]` — summary + by_reason ใช้ได้เลย, ตารางที่เหลือว่างจนกว่า BE จะขึ้น. ขอแค่ **ชื่อ field และชนิดข้อมูลตรงตามนี้**.

Thai labels ของ reason ทำฝั่ง FE แล้ว (`EXPIRED`=หมดอายุ, `SPILLED`=หก/เสียระหว่างทำ, `TRIAL`=ชิม/ทดลอง, `DAMAGED`=ชำรุด, `OTHER`=อื่น ๆ) — BE ส่ง **code** มาพอ.
