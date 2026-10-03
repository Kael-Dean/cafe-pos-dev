# Salesperson ↔ Member KPI — Design

**Date:** 2026-06-12
**Status:** Approved (design)
**Branch:** feat/order-cancel-restock (to be moved to its own branch for implementation)

## Problem

The org has a new policy: each member (customer) is assigned to a *sales* person
(เซลส์). A salesperson's KPI is measured by how much of their assigned members
actually come buy at the store. We must prepare data so the frontend can render a
report, queryable by date range, showing — for each member under each salesperson —
how much they bought, what they bought, item count, and total value.

Almost every member has a salesperson; a few have none (stay `NULL`).

## Source data reconciliation

Source: `resources/รายชื่อเจ้าหน้าที่ แยกสาขา.xlsx` (131 rows; cols: first name,
last name, sales nickname). Three salespeople: **พี่เมย์, พี่แสง, เอ็ม**.

Reconciled against the 138 already-seeded members (`scripts/_members_seed_data.py`):

- 127 exact name matches.
- 4 typo/near-matches, resolved to the seeded members:
  - สุภาภรณ์ **จันทรบุตร** → `จันทบุตร`
  - จันทร์ทิพย์ **มาลิตร์** → `มาลิตร`
  - **ณัฐฟล** คำเสมอ → `ณัฐพล คำเสมอ`
  - พรพิมล **สง่างาม** → `พรพิมล โพธิ์แก้ว` (same first name; last name corrected)
- **129 members assigned** (พี่แสง 45, พี่เมย์ 44, เอ็ม 40); 9 stay `NULL`
  (2 explicitly blank in the list + 7 never listed).

Mapping keyed on the stable **mock phone** (`0000000xxx`), not name, so the typos
are resolved once at extraction time and the seed stays deterministic.

## Data model

**New table `salespeople`** (`app/models/sales.py`):

| column | type | notes |
|---|---|---|
| `id` | `String(24)` PK | CUID |
| `store_id` | FK → `stores.id` CASCADE, indexed | from JWT |
| `name` | `String(120)` | nickname |
| `is_active` | `Boolean` default true | |
| `created_at` / `updated_at` | via `TimestampMixin` | |

Unique constraint `uq_salespeople_store_name` on `(store_id, name)`.

**`customers` gains** `sales_id` → `String(24)`, `ForeignKey("salespeople.id",
ondelete="SET NULL")`, **nullable**, indexed. Deleting a salesperson nulls the
assignment rather than cascading to members.

Register `Salesperson` in `app/models/__init__.py`.

## Migration

One additive Alembic revision `0024_salespeople`:
1. `create_table("salespeople", ...)` + unique constraint.
2. `add_column("customers", sales_id)` + FK + index `ix_customers_sales_id`.

Schema-only (no enum types → no manual `CREATE TYPE`). Data backfill is handled by
the idempotent seed, not the migration.

## Seeding & backfill

- `scripts/_sales_seed_data.py` — embedded `SALESPEOPLE` list and
  `MEMBER_SALES: dict[phone, nickname]` (129 entries). Embedded so Railway runs
  without the xlsx / openpyxl.
- `scripts/seed_sales.py` — idempotent:
  1. Upsert the 3 salespeople for the store (skip if `(store_id, name)` exists).
  2. For each `phone → nickname`, look up customer by `(store_id, phone)` and set
     `sales_id` if not already set to that salesperson. Re-running = no-op.
- Wire into `railway.toml` `preDeployCommand` after `seed_customers.py`.

## APIs

**List salespeople** — `app/api/v1/salespeople.py`, registered in `router.py`:
- `GET /salespeople` → `[{id, name, is_active}]`, role `_BARISTA_PLUS`.

**Assignment** (dedicated endpoint so we can set *and clear*):
- `PATCH /customers/{customer_id}/sales` body `{ "sales_id": "<id>" | null }`,
  role `_BARISTA_PLUS`. Validates salesperson belongs to the store; 404 otherwise.
- `CustomerRead` gains `sales_id` and `sales_name`.

**KPI report** — `app/api/v1/reports.py`:
- `GET /reports/salesperson-kpi?from=...&to=...`, role `_MANAGER_PLUS`.
- Chain `Order → Customer → Salesperson`; filter `created_at` in `[from, to]` and
  `status in _REVENUE_STATUSES` (excludes VOID — same definition as other reports).
- Zero-buyer members are **included** with zeros (KPI denominator).
- Unassigned members are **excluded** from this report.

Response:
```jsonc
{
  "from": "...", "to": "...",
  "salespeople": [{
    "sales_id": "...", "sales_name": "พี่เมย์",
    "member_count": 44, "buying_member_count": 12,
    "total_items": 87, "total_value": "12345.00",
    "members": [{
      "customer_id": "...", "name": "...", "phone": "...",
      "order_count": 3, "total_items": 9, "total_value": "980.00",
      "items": [ {"product_name": "Latte", "quantity": 4, "value": "320.00"} ]
    }]
  }]
}
```
`value` per item = `Σ quantity × unit_price` (matches `get_sales_report`).

## Testing

Real Postgres. Add `make_salesperson` factory.
- Model/migration: `sales_id` nullable; FK `SET NULL` on salesperson delete.
- Assignment: set, clear (`null`), 404 cross-store, role gate.
- KPI report: multi-order aggregation; VOID excluded; orders without `customer_id`
  excluded; zero-buyer members appear with zeros; `buying_member_count ≤
  member_count`; inclusive date boundary; store isolation.
- Seed idempotency: second run is a no-op; the 4 typos resolve to the right phones.

## Out of scope (YAGNI)

Salesperson CRUD/deactivation UI; historical reassignment tracking; cross-store
salespeople; per-salesperson login.

## Appendix: full phone → sales mapping

Keyed on the seeded mock phone. 129 assigned, 9 unassigned (null).

| phone | member | sales |
|---|---|---|
| 0000000001 | กมลทิพย์ พิมพ์เสน | พี่เมย์ |
| 0000000002 | รัชฎาวรรณ เจือจันทร์ | พี่เมย์ |
| 0000000003 | ทองดี พลสวัสดิ์ | พี่เมย์ |
| 0000000004 | สุระ อุณชาติ | พี่เมย์ |
| 0000000005 | สุภานัน จงอุตส่าห์ | พี่เมย์ |
| 0000000006 | พัฒนพงษ์ อรรคสาร | พี่แสง |
| 0000000007 | สุภาวดี ศรีจันทร์ | เอ็ม |
| 0000000008 | จำนงค์ หวังสุดดี | พี่เมย์ |
| 0000000009 | พรทิพย์ เศษกลาง | เอ็ม |
| 0000000010 | สมเดช ไพสนิท | พี่เมย์ |
| 0000000011 | สุภาภรณ์ จันทบุตร | พี่แสง |
| 0000000012 | สุพิศ ภักดิ์ไสย์ | พี่แสง |
| 0000000013 | สมนึก อยู่นาน | เอ็ม |
| 0000000014 | ชานนท์ ใยแดง | เอ็ม |
| 0000000015 | ชนัดฎา บัวสาย | เอ็ม |
| 0000000016 | สุรชาติ เชี่ยวชาญ | เอ็ม |
| 0000000017 | บุญเชิด อุไร | พี่เมย์ |
| 0000000018 | วราลักษณ์ เพชรหนองชุม | พี่เมย์ |
| 0000000019 | ยุภา สาแก้ว | พี่แสง |
| 0000000020 | กัณตภณ จารัตน์ | เอ็ม |
| 0000000021 | สันทนา พิเดช | เอ็ม |
| 0000000022 | ปุณิกา บรรเทาทุกข์ | พี่เมย์ |
| 0000000023 | ชุติมา พลบูรณ์ศรี | พี่แสง |
| 0000000024 | กำชัย บุญแต้ม | พี่แสง |
| 0000000025 | พรศักดิ์ หวังสุดดี | เอ็ม |
| 0000000026 | จันทร์เทพ พยุงเกษม | เอ็ม |
| 0000000027 | นิภากร อุดทุม | พี่แสง |
| 0000000028 | รุ้งนภา เอิบอิ่ม | พี่เมย์ |
| 0000000029 | นวพร พะเนตรรัมย์ | เอ็ม |
| 0000000030 | ผดุงเกียรติ เหล่าธีรกาญจนา | เอ็ม |
| 0000000031 | วีรชัย ประวันเตา | พี่แสง |
| 0000000032 | คงฤทธิ์ จิรันดร | เอ็ม |
| 0000000033 | วรวุฒิ โพธิ์หิรัญ | เอ็ม |
| 0000000034 | ธีรวัฒน์ อสิพงษ์ | พี่แสง |
| 0000000035 | สุมาลี เจือจันทร์ | เอ็ม |
| 0000000036 | หนูไกร ไกรงาม | พี่แสง |
| 0000000037 | ศศินันท์ ทำทอง | พี่เมย์ |
| 0000000038 | อธิวัฒน์ จันทะสิงห์ | พี่แสง |
| 0000000039 | บัวหอม เกษมสุข | พี่เมย์ |
| 0000000040 | สมชาย แสนเจตนา | พี่เมย์ |
| 0000000041 | สุรศักดิ์ แจ่มแจ้ง | เอ็ม |
| 0000000042 | สมภพ หวังผล | พี่แสง |
| 0000000043 | เพชร อุตธูร | เอ็ม |
| 0000000044 | รัฐกานต์ สุนทรารักษ์ | พี่เมย์ |
| 0000000045 | สัมฤทธิ์ ทองอ้ม | พี่แสง |
| 0000000047 | วิศรุต ค้ำคูณ | เอ็ม |
| 0000000048 | ลดาพรรณ ชมภูนุช | พี่แสง |
| 0000000049 | มาลิน คุมสุข | พี่แสง |
| 0000000050 | ธีรพงษ์ ศรีสุข | พี่เมย์ |
| 0000000051 | ปิยะ วรรณทอง | เอ็ม |
| 0000000052 | ธัญญธร หมายเจริญ | พี่เมย์ |
| 0000000053 | ภัทรา ประดับสุข | เอ็ม |
| 0000000054 | พักตรา บุตรลักษณ์ | เอ็ม |
| 0000000055 | วิไลรัตน์ ยวนยี | พี่เมย์ |
| 0000000056 | พีรพัฒน์ กรวยทอง | พี่แสง |
| 0000000057 | สุริยา นาลา | พี่แสง |
| 0000000058 | ทศพร เป็นสุข | พี่เมย์ |
| 0000000059 | ทนงศักดิ์ บุญสอน | เอ็ม |
| 0000000060 | อารีรัตน์ บุญสอน | พี่แสง |
| 0000000061 | อริยา เชิดสุข | พี่เมย์ |
| 0000000062 | ณหทัย ใบพลูทอง | เอ็ม |
| 0000000063 | ขวัญฤทัย จันทร์ฝอย | พี่แสง |
| 0000000064 | ภูษิต ขวัญยืน | พี่เมย์ |
| 0000000065 | สุมาลี สร้อยจิตร | พี่เมย์ |
| 0000000066 | วินัย สำรวย | เอ็ม |
| 0000000067 | จรัญยา สุระพล | พี่เมย์ |
| 0000000068 | เยือนณะภา บุญแต้ม | พี่แสง |
| 0000000069 | พงศธร ทวีศรี | พี่แสง |
| 0000000070 | คมสัน ขันโมลี | พี่แสง |
| 0000000071 | ชนัญธิดา ศรีสุข | เอ็ม |
| 0000000072 | ศรราม แสนกล้า | เอ็ม |
| 0000000074 | อนุศาสตร์ เรือนริน | พี่เมย์ |
| 0000000075 | ศราวุธ แสนรู้ | พี่เมย์ |
| 0000000076 | ณัฐดนัย อุปถัมภ์ | พี่เมย์ |
| 0000000077 | ธนารักษ์ สุดยอดสุข | เอ็ม |
| 0000000078 | ขนิษฐา วุฒิยา | พี่เมย์ |
| 0000000079 | นิธิธร วิยาสิงห์ | เอ็ม |
| 0000000080 | พงษ์พรรณ เหลื่อมล้ำ | พี่เมย์ |
| 0000000081 | กนกพรรณ พุตดอน | พี่เมย์ |
| 0000000082 | วิจิตรา สันตวง | พี่แสง |
| 0000000083 | พรพิมล โพธิ์แก้ว | พี่แสง |
| 0000000084 | จิรเดช จงกลาง | พี่เมย์ |
| 0000000085 | ปรินทร ลอยลม | พี่เมย์ |
| 0000000086 | ณิชารัชต์ เส้นศูนย์ | พี่แสง |
| 0000000087 | นิชธาวัลย์ บุญสุข | พี่เมย์ |
| 0000000088 | วุฒิชัย พ่อค้า | เอ็ม |
| 0000000089 | ปณชัย ถาวร | พี่แสง |
| 0000000090 | พัชรีภรณ์ ทองคำสาร | เอ็ม |
| 0000000091 | เสาวลักษณ์ อุไร | พี่เมย์ |
| 0000000092 | วีรวัฒน์ ศรีไสว | พี่เมย์ |
| 0000000093 | กาญจนา ดาทอง | พี่แสง |
| 0000000094 | อนัญญา วันถุนัด | พี่แสง |
| 0000000095 | ศุภลักษณ์ สุขเต็ม | พี่เมย์ |
| 0000000096 | ดุลยกิตติ์ คิดดี | เอ็ม |
| 0000000097 | ไตรภพ ศรีพรหม | เอ็ม |
| 0000000098 | นุสิตา สุดหนองบัว | พี่เมย์ |
| 0000000099 | กิตติพงษ์ อุ่นวิเศษ | พี่แสง |
| 0000000100 | ชุติกาญจน์ ทูลภิรมย์ | เอ็ม |
| 0000000101 | ฐิติมา อุดมศักดิ์ | พี่แสง |
| 0000000102 | วรรณภา ผดุงดี | พี่เมย์ |
| 0000000103 | เชิด สามลา | เอ็ม |
| 0000000105 | วิลาวัลย์ คงดี | เอ็ม |
| 0000000106 | หวาด สงคราม | เอ็ม |
| 0000000109 | เบญจมาศ สวยรูป | พี่แสง |
| 0000000110 | จันทร์ทิพย์ มาลิตร | พี่แสง |
| 0000000111 | บุญโฮม ภิญโญ | พี่แสง |
| 0000000112 | สี สืบสาย | พี่แสง |
| 0000000114 | เสงี่ยม หาดทราย | พี่แสง |
| 0000000115 | สุรชัย หันตุลา | พี่แสง |
| 0000000117 | ภัทราพร สุดจำนงค์ | เอ็ม |
| 0000000119 | ปัทมา สวนงาม | พี่เมย์ |
| 0000000120 | สิทธิชัย เสกกล้า | เอ็ม |
| 0000000121 | ดุจดาว สุขอยู่ | พี่แสง |
| 0000000122 | ดวงดี กองบุตร | พี่แสง |
| 0000000124 | อรณี เจริญศรี | เอ็ม |
| 0000000125 | สุรชัย บุญหวัง | พี่แสง |
| 0000000126 | ธีระพล นิลแก้ว | พี่เมย์ |
| 0000000127 | วิรัตน์ รัตนวิวัฒ | พี่แสง |
| 0000000128 | วาสนา ทุมจันทร์ | พี่แสง |
| 0000000129 | เพ็ชร อนุชาติ | พี่แสง |
| 0000000130 | สุราลัย อุตธูร | พี่เมย์ |
| 0000000131 | ชิสา สมานโสร์ | พี่เมย์ |
| 0000000132 | ศิวัฒ กงทอง | เอ็ม |
| 0000000133 | สมบัติ วาพัดไทย | พี่เมย์ |
| 0000000134 | อนงค์ เพชรมาก | พี่เมย์ |
| 0000000135 | ธนากร จะลงประโคน | พี่เมย์ |
| 0000000136 | ณัฐพล คำเสมอ | พี่แสง |
| 0000000137 | วงศ์เดือน จำปาทอง | พี่แสง |
| 0000000138 | ยุพิน ภักดิ์ไสย์ | พี่แสง |

### Unassigned (sales_id stays NULL)

| phone | member | sales |
|---|---|---|
| 0000000046 | แสงอาทิตย์ ประคองชื่อ | — |
| 0000000073 | ณัฐธยาน์ คณาดี | — |
| 0000000104 | พิไลพร จันทร์ฝอย | — |
| 0000000107 | สำรวย จรันรัก | — |
| 0000000108 | สมจิตร เข็มรัตน์ | — |
| 0000000113 | สุริยา เกิดผิวดี | — |
| 0000000116 | สมคิด เกิดผิวดี | — |
| 0000000118 | สุนันท์ ศรีจันแปลง | — |
| 0000000123 | ปราถนา แผ่นงา | — |
