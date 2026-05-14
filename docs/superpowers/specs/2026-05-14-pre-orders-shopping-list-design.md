# Design: Pre-Orders & Shopping List

**Date:** 2026-05-14  
**Source:** `api-handoff.md`  
**Approach:** Option A — Single file per screen, matching existing `inventory.tsx` pattern

---

## Overview

Two new sidebar items added to the POS app:

1. **Pre-Orders** — Café staff create advance orders (custom cakes, large batches), review ingredient requirements, then start production (deducts stock) and complete when handed off.
2. **Shopping List** — Per-store persistent list of ingredients that need restocking; populated manually or from the ingredient summary in a pre-order.

All endpoints require authenticated store user (BARISTA+). `store_id` is derived from JWT.

---

## Architecture

### New Files (4 total)

| File | Purpose |
|------|---------|
| `src/hooks/use-pre-orders.ts` | Backend interfaces, camelCase frontend types, mappers, all pre-order hooks |
| `src/hooks/use-shopping-list.ts` | Backend interfaces, frontend types, mappers, shopping list hooks |
| `src/components/screens/pre-orders.tsx` | Pre-Orders screen UI |
| `src/components/screens/shopping-list.tsx` | Shopping List screen UI |

### Modified Files (2 total)

| File | Change |
|------|--------|
| `src/components/app-common.tsx` | Add 2 new NAV entries |
| `src/app/page.tsx` | Add `'pre-orders' \| 'shopping-list'` to Screen type, import + register new screens |

---

## Navigation

Add to `NAV` array in `app-common.tsx`, after the `inventory` entry:

```typescript
{ id: 'pre-orders',    label: 'Pre-Orders',    icon: 'calendar' },
{ id: 'shopping-list', label: 'Shopping List',  icon: 'cart' },
```

---

## Hooks Architecture

### `use-pre-orders.ts`

**Backend interfaces** (snake_case, match API exactly):
- `PreOrderRead`, `PreOrderItemRead`, `PreOrderSummary`, `PreOrdersPage`
- `IngredientSummaryItem`, `IngredientSummary`

**Frontend interfaces** (camelCase):
- `PreOrder` — mapped from `PreOrderRead`
- `PreOrderItem` — mapped from `PreOrderItemRead`
- `PreOrderListItem` — mapped from `PreOrderSummary`
- `IngredientLine` — mapped from `IngredientSummaryItem`

**Key mapping rules:**
- All decimal string fields (`unit_price`, `line_total`, `deposit_amount`) remain as `string` on the frontend — do NOT use `parseFloat` (per handoff notes)
- `usage_pct` stays `number | null`
- `order_date` / `due_date` stay as `"YYYY-MM-DD"` strings

**Exported hooks:**

| Hook | Method | Endpoint |
|------|--------|----------|
| `usePreOrders(status?, page?, limit?)` | GET | `/api/v1/pre-orders` |
| `usePreOrder(id)` | GET | `/api/v1/pre-orders/{id}` |
| `useCreatePreOrder()` | POST | `/api/v1/pre-orders` |
| `useUpdatePreOrder()` | PATCH | `/api/v1/pre-orders/{id}` |
| `useAddPreOrderItem()` | POST | `/api/v1/pre-orders/{id}/items` |
| `useRemovePreOrderItem()` | DELETE | `/api/v1/pre-orders/{id}/items/{item_id}` |
| `usePreOrderIngredients(id, threshold?)` | GET | `/api/v1/pre-orders/{id}/ingredients` |
| `useStartPreOrder()` | POST | `/api/v1/pre-orders/{id}/start` |
| `useCompletePreOrder()` | POST | `/api/v1/pre-orders/{id}/complete` |
| `useCancelPreOrder()` | POST | `/api/v1/pre-orders/{id}/cancel` |

**Query key conventions:**
- `['pre-orders', status, page, limit]` for list
- `['pre-order', id]` for detail
- `['pre-order-ingredients', id, threshold]` for ingredient summary

Mutations invalidate `['pre-orders']` and `['pre-order', id]` on success.  
`useStartPreOrder` and `useCompletePreOrder` also invalidate `['inventory']` (stock changes).

### `use-shopping-list.ts`

**Backend interface:** `ShoppingListItemRead`

**Frontend interface:** `ShoppingListItem` (camelCase mapped)

**Exported hooks:**

| Hook | Method | Endpoint |
|------|--------|----------|
| `useShoppingList()` | GET | `/api/v1/shopping-list` |
| `useAddToShoppingList()` | POST | `/api/v1/shopping-list` |
| `useRemoveFromShoppingList()` | DELETE | `/api/v1/shopping-list/{item_id}` |

Query key: `['shopping-list']`. All mutations invalidate `['shopping-list']`.  
`useAddToShoppingList` also invalidates `['pre-order-ingredients', ...]` so `on_shopping_list` badges refresh.

---

## Pre-Orders Screen (`pre-orders.tsx`)

### Layout

Two-column layout (same CSS pattern as `inventory.tsx`):
- **Left column** (~380px): filter bar + pre-order list
- **Right column** (flex 1): detail panel for selected order

### Left Column

**Filter bar:**
- Status filter pills: `All | Pending | In Progress | Completed | Cancelled`
- `+ สร้าง Pre-Order` button (opens Create modal)

**List items** — card per pre-order showing:
- Customer name + phone
- Due date (formatted `dd MMM yy` Thai locale)
- `item_count` badge
- Status badge — color per spec: `PENDING`=yellow, `IN_PROGRESS`=blue, `COMPLETED`=green, `CANCELLED`=grey

### Right Column (Detail Panel)

**Empty state** when nothing selected: prompt to select from list.

**When a pre-order is selected**, shows two internal tabs:
- **รายละเอียด** (Details)
- **วัตถุดิบ** (Ingredients)

#### Details Tab

Header info (read-only, or editable inline when PENDING):
- Customer name, phone
- Order date, due date
- Deposit amount + deposit paid checkbox
- Notes

Items table columns: `สินค้า | จำนวน | ราคา/ชิ้น | รวม`
- When PENDING: `+ เพิ่มสินค้า` row at the bottom, delete (×) per row
- When not PENDING: read-only

Action buttons (bottom, context-sensitive by status):

| Status | Actions shown |
|--------|--------------|
| `PENDING` | `แก้ไข` (opens edit modal), `เริ่มผลิต` (with confirm dialog — irreversible), `ยกเลิก` |
| `IN_PROGRESS` | `เสร็จสิ้น / ส่งมอบ` |
| `COMPLETED` | (none — read only) |
| `CANCELLED` | (none — read only) |

**Start Production confirm dialog:**  
> "การเริ่มผลิตจะตัดสต็อกวัตถุดิบทันทีและไม่สามารถย้อนกลับได้ ต้องการดำเนินการต่อหรือไม่?"  
> Buttons: `ยืนยัน` / `ยกเลิก`

#### Ingredients Tab

Calls `usePreOrderIngredients(id)`. Shows a table:

| คอลัมน์ | แหล่งที่มา |
|---------|-----------|
| ชื่อวัตถุดิบ + หน่วย | `name`, `unit` |
| ต้องการ | `qty_needed` |
| สต็อก | `stock_on_hand` |
| ใช้ % | `usage_pct` (null → "—", format to 1 decimal) |
| สถานะ | `exceeds_threshold` → red badge "สต็อกต่ำ" |
| Shopping List | `on_shopping_list` → grey badge "มีแล้ว" OR `+ เพิ่ม` button |

Threshold slider (0–100, default 50) — changing it re-fetches.

### Create Pre-Order Modal

Full-width scrollable modal (follows `modifier-modal.tsx` style):

**Section 1 — ลูกค้า:**
- Toggle: `ลูกค้าใหม่` (inline) vs `ลูกค้าที่มีในระบบ` (customer_id lookup — future, use inline for now)
- Fields: `ชื่อ` (max 120), `เบอร์โทร` (max 30)

**Section 2 — ข้อมูลออเดอร์:**
- `วันที่สั่ง` (date input, default today)
- `กำหนดส่ง` (date input, required)
- `มัดจำ` (number input, ≥ 0)
- `รับมัดจำแล้ว` (checkbox)
- `หมายเหตุ` (textarea)

**Section 3 — รายการสินค้า:**
- Table with `+ เพิ่มสินค้า` row at bottom
- Each row: product select (searchable dropdown using `useAllProducts()` from `use-products.ts`) + qty input + optional unit_price override
- Min 1 item required (validated before submit)

**Footer:**
- Total amount (sum of line_totals, computed client-side for display)
- `สร้าง Pre-Order` button (disabled while loading)
- Error display for CUSTOMER_REQUIRED, 404 product errors

### Edit Pre-Order Modal

Same as Create but pre-filled, only header fields (no item editing — items edited inline in detail panel). Only shows when `status === 'PENDING'`.

---

## Shopping List Screen (`shopping-list.tsx`)

### Layout

Single-column, full height with scroll.

**Header:**
- Title: `Shopping List`
- `🖨 พิมพ์รายการ` button — opens `/api/v1/shopping-list/print` in new tab (`window.open`)

**Item list:**

Each row:
- Ingredient name + unit
- Note (if set, shown below name in secondary color)
- `×` delete button (calls `useRemoveFromShoppingList`, then invalidates query)

**Empty state:**
- Icon + text "รายการว่างเปล่า" when list has no items

**Add item:**
- `+ เพิ่มวัตถุดิบ` button at top right of header
- Opens inline mini-form: inventory item search dropdown + optional note field + `เพิ่ม` button

---

## Error Handling

All mutations use `onError` to call `useToast()`:
- `CUSTOMER_REQUIRED` → "กรุณากรอกข้อมูลลูกค้า"
- `PRE_ORDER_NOT_PENDING` → "ไม่สามารถแก้ไขได้ — ออเดอร์เริ่มผลิตแล้ว"
- `PRE_ORDER_ALREADY_STARTED` → "ออเดอร์นี้เริ่มผลิตแล้ว"
- `PRE_ORDER_NOT_IN_PROGRESS` → "ออเดอร์ยังไม่ได้เริ่มผลิต"
- `PRE_ORDER_NO_ITEMS` → "ไม่มีรายการสินค้าที่มี recipe"
- Generic 404/500 → `error.message`

---

## Decimal Handling

Per handoff: all money/quantity fields from API are decimal strings. **Do not use `parseFloat`.**  
Display with `Number(value).toFixed(2)` for money, `Number(value).toFixed(3)` for quantities.  
The `baht()` helper from `app-common` can be used for money display.

---

## Non-Goals (out of scope for this phase)

- Customer ID lookup / linked customer record (use inline name+phone only)
- Real-time push for status changes (polling/manual refresh is fine)
- Bulk operations on pre-orders
- Editing items after order is IN_PROGRESS (blocked by API)
