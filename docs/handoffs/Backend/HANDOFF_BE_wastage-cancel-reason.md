# Backend Handoff — Wastage reason for canceled-order write-offs

**Date:** 2026-06-15
**For:** Backend dev (caf-pos-repo / FastAPI → Railway)
**Requested by:** owner
**Side:** Backend · **FE already shipped** (see "Frontend done" below)

---

## Problem

ยกเลิกออเดอร์แบบไม่คืน stock (`restock=false`) → ระบบตัดวัตถุดิบเป็น `WASTE` ถูกต้องแล้ว
**แต่** waste reason ถูก hardcode เป็น `WastageReason.TRIAL` → รายงานของเสียโชว์เหตุผล **"ชิม / ทดลอง"** ซึ่งผิดความหมาย (ของจากออเดอร์ยกเลิก ไม่ใช่การชิม/ทดลอง)

นอกจากนี้ เหตุผลที่พนักงานพิมพ์ในจอยกเลิก (`req.reason`, เช่น "ลูกค้าสั่งผิด") ถูกเก็บไว้ใน `OrderVoidLog` เท่านั้น — **ไม่โผล่ในรายงานของเสีย** ทำให้ดูรายงานแล้วไม่รู้ว่าทำไมถึงยกเลิก

## Goal

1. เพิ่มเหตุผลใหม่ `WastageReason.CANCELED` แล้วใช้กับ waste ที่เกิดจากการยกเลิกออเดอร์ (แทน `TRIAL`)
2. เอา `req.reason` (เหตุผลที่พนักงานพิมพ์) ใส่ลง note ของ waste movement → โผล่ในช่อง "หมายเหตุ" ของรายงาน

**ไม่ต้อง migration** — `stock_movements.reason` เป็น `Text` (เก็บ `"<CODE>|<note>"`), `WastageReason` เป็น `StrEnum` ระดับแอป ไม่ใช่ Postgres enum type.

---

## Change 1 — `app/enums.py`

เพิ่มค่าใน `WastageReason`:

```python
class WastageReason(enum.StrEnum):
    EXPIRED = "EXPIRED"
    SPILLED = "SPILLED"
    TRIAL = "TRIAL"
    DAMAGED = "DAMAGED"
    CANCELED = "CANCELED"   # NEW — system-set on order-cancel write-offs (not user-selectable)
    OTHER = "OTHER"
```

> `_decode_movement_reason` ทำ `WastageReason(head)` — ค่า `CANCELED` ต้องมีใน enum ไม่งั้น decode ไม่ออกแล้วตกไป `OTHER`. การเพิ่มบรรทัดนี้คือสิ่งที่ทำให้รายงาน decode เป็น `CANCELED` ได้.

## Change 2 — `app/services/orders.py` (void flow, ~line 414-419)

เดิม:
```python
if not req.restock:
    from app.services.inventory import _encode_waste_reason

    waste_reason = _encode_waste_reason(
        WastageReason.TRIAL, f"Canceled order #{order.order_number}"
    )
```

แก้เป็น:
```python
if not req.restock:
    from app.services.inventory import _encode_waste_reason

    note = f"Canceled order #{order.order_number}"
    if req.reason:
        note = f"{note}: {req.reason}"
    waste_reason = _encode_waste_reason(WastageReason.CANCELED, note)
```

- reason_code → `CANCELED`
- note → `"Canceled order #1044: ลูกค้าสั่งผิด"` (ต่อ `req.reason` ถ้ามี; FE บังคับกรอกอยู่แล้ว แต่ guard ค่าว่างไว้ด้วย)
- `OrderVoidLog(reason=req.reason)` คงเดิม — log การยกเลิกยังเก็บเหมือนเดิม

---

## Backward compatibility

- Movement เก่าที่เป็น `TRIAL|Canceled order #...` ยังอยู่เหมือนเดิม → รายงานจะยังโชว์ "ชิม / ทดลอง" สำหรับของย้อนหลัง (ไม่ relabel ย้อนหลัง). ของใหม่ตั้งแต่ deploy = `CANCELED`.
- Field ใหม่เป็น additive — endpoint/schema อื่นไม่กระทบ. ไม่ต้องแตะ `schemas/reports.py` (reason_code เป็น `str`).
- `record_waste` (manual wastage) ไม่เปลี่ยน — `CANCELED` ไม่เปิดให้เลือกเองจาก UI.

## Acceptance

- ยกเลิกออเดอร์แบบ `restock=false` → waste movement มี `reason_code == "CANCELED"`, note = `"Canceled order #<n>: <req.reason>"`.
- `GET /api/v1/reports/wastage` คืน event ของรายการนั้นด้วย `reason_code="CANCELED"` และ `note` ที่มีเหตุผลที่พิมพ์.
- ยกเลิกแบบ `restock=true` → ไม่สร้าง waste (เหมือนเดิม).
- Tests: ดู `tests/test_orders_service.py` (void flow) — assert reason_code=`CANCELED` + note contains req.reason; และ wastage report รวม event นี้.

---

## Frontend done (FYI — ไม่ต้องแก้ FE)

ขึ้น dev แล้ว ([reports commit ตามมา]):
- `use-wastage-report.ts` — REASON_LABEL เพิ่ม `CANCELED: 'ยกเลิกออเดอร์'`
- `use-inventory.ts` — `WastageReason` union เพิ่ม `'CANCELED'`
- `inventory.tsx` — movement history label CANCELED → "ยกเลิกออเดอร์" (แยกจาก dropdown เลือกเอง; CANCELED ไม่อยู่ในตัวเลือก manual)
- ช่อง "หมายเหตุ" ในรายงานโชว์ note ตามที่ BE ส่งมาอยู่แล้ว — แค่ BE ใส่ `req.reason` ลง note ก็โผล่

FE tolerant: ถ้า BE ยังไม่ deploy การเปลี่ยนนี้ ของใหม่จะยังเป็น `TRIAL`/"ชิม / ทดลอง" จนกว่า BE จะขึ้น — ไม่ error.
