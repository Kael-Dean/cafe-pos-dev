# API Handoff: unit_price Moved to Receipt Lot (Breaking Change)

## Business Context

Previously, `unit_price` (cost per pack/bottle) was captured once when creating an ingredient and was fixed indefinitely. This was wrong for a café — prices change with every delivery. The price field has been moved to the **receipt lot** so each bill records the actual price paid that day. `cost_per_unit` on the ingredient now reflects the last confirmed receipt and starts at `0` until the first receipt is posted.

---

## Breaking Change 1: `POST /api/v1/receipts/{receipt_id}/lots`

`unit_price` is now **required** in the lot payload. Previously it was read from the ingredient definition.

### What changed

| | Before | After |
|---|---|---|
| `unit_price` | Read from ingredient automatically | **Caller must supply per lot** |
| `cost_per_unit` | Fixed from ingredient definition | Computed as `unit_price / unit_size` per lot |

### Request body

```diff
  {
    "inventory_item_id": "cuid",
    "qty_packs": "4",
+   "unit_price": "255.00",
    "expiry_date": "2026-06-15"
  }
```

`unit_price` = price paid **per pack/bottle/bag** on this receipt. Must be `> 0`, max `99999.99`.

### Example

Ingredient "Fresh Milk" has `unit_size = 3` (litres per carton). Sending `qty_packs: 4, unit_price: 255.00` results in:
- `qty_received = 12` (4 cartons × 3 litres)
- `cost_per_unit = 85.0000` (฿255 ÷ 3 litres)
- `unit_price = 255.00` echoed back in the response

### Errors

| Status | Code | When |
|---|---|---|
| 422 | _(validation)_ | `unit_price` missing, ≤ 0, or > 99999.99 |
| 422 | `ITEM_MISSING_UNIT_SIZE` | Ingredient has no `unit_size` — fix ingredient first |
| 409 | `RECEIPT_ALREADY_CONFIRMED` | Receipt already confirmed |
| 404 | `NOT_FOUND` | Item or receipt not found in this store |

---

## Breaking Change 2: `POST /api/v1/inventory` (Create ingredient)

`unit_price` is **no longer accepted**. Sending it now returns a 422 validation error.

### What changed

| | Before | After |
|---|---|---|
| `unit_price` | Required | **Removed — do not send** |
| `cost_per_unit` | Computed at creation (`unit_price / unit_size`) | Always `0` until first receipt confirmed |

### Request body

```diff
  {
    "name": "Fresh Milk",
    "unit": "ml",
    "unit_size": "3000",
-   "unit_price": "255.00",
    "par_level": "30"
  }
```

### Response

`cost_per_unit` will be `"0"` on a newly created ingredient. `unit_price` in the read schema is now always `null` (the field still exists in the response for backwards compatibility but is never populated).

---

## Updated Response Shape: `StockLotRead`

All endpoints returning lot objects now include `unit_price`:

```json
{
  "id": "cuid",
  "inventory_item_id": "cuid",
  "inventory_item_name": "Fresh Milk",
  "qty_packs": "4.000",
  "qty_received": "12.000",
  "qty_remaining": "12.000",
  "unit_price": "255.00",
  "cost_per_unit": "85.0000",
  "expiry_date": "2026-06-15",
  "created_at": "2026-05-16T07:00:00Z"
}
```

| Field | Meaning |
|---|---|
| `unit_price` | Price paid per pack/bottle on this specific receipt |
| `cost_per_unit` | Cost per raw unit (`unit_price / unit_size`) |
| `qty_packs` | Number of packs entered by manager |
| `qty_received` | Total raw units (`qty_packs × unit_size`) |

Affected endpoints:
- `POST /api/v1/receipts/{id}/lots` (201)
- `GET /api/v1/receipts/{id}`
- `GET /api/v1/inventory/{item_id}/lots`

---

## UI Changes Required

### Add lot form (receipt entry screen)
Add a **"Price per pack"** (`unit_price`) field — required, numeric, positive.

Show computed confirmation before submit:
> 4 cartons × ฿255.00 = **฿1,020.00** total · ฿85.00/litre

### Lot display
Show `unit_price` as the pack price alongside `cost_per_unit` as the per-unit cost if both are displayed.

### Create ingredient form
**Remove the `unit_price` / "Price per pack" field entirely.** The form now only needs: name, unit, unit_size, par_level.

### Ingredient detail / list view
`cost_per_unit` will show `0` for newly created ingredients until a receipt is confirmed. Consider showing "No receipts yet" or `—` instead of `฿0.00` to avoid confusing managers.

---

## Related Previous Change

This builds on the prior `qty_packs` handoff (`receipt-lot-qty-packs-handoff.md`). The lot payload now requires both `qty_packs` AND `unit_price`.

Full current lot payload:
```json
{
  "inventory_item_id": "cuid",
  "qty_packs": "4",
  "unit_price": "255.00",
  "expiry_date": "2026-06-15"
}
```
