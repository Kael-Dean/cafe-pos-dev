# Frontend UX: Receipt Lot Entry — Total Price Input + Searchable Ingredient Dropdown

## What to Change

The batch receipt entry form currently asks the user for **price per pack** (`unit_price`). Change it so the user enters the **total amount paid** for the entire batch instead. The frontend computes `unit_price` before sending to the backend — the API payload is unchanged.

---

## Field Change

| Field | Before | After |
|---|---|---|
| Label | ราคา/แพ็ค (฿) | ราคารวม (฿) |
| Meaning | Price per pack/bottle | Total price paid for all packs |
| API field sent | `unit_price` (as entered) | `unit_price` = `total_price / qty_packs` |

---

## How the Frontend Should Compute `unit_price`

```
unit_price = total_price / qty_packs
```

Round to 2 decimal places before sending. Send `unit_price` in the API payload exactly as before — the backend does not change.

### Example

User enters `qty_packs = 4`, `total_price = 1020.00`

- Computed: `unit_price = 1020 / 4 = 255.00`
- Payload sent to `POST /api/v1/receipts/{id}/lots`:

```json
{
  "inventory_item_id": "...",
  "qty_packs": "4",
  "unit_price": "255.00",
  "expiry_date": "2026-06-15"
}
```

---

## Validation

- `total_price` must be `> 0`
- `total_price` max: `99999.99` × `qty_packs` (effectively uncapped for reasonable inputs — just mirror the existing `unit_price` constraint: result after division must be ≤ `99999.99`)
- Only compute and send when both `qty_packs` and `total_price` are filled and valid

---

## Optional: Show a Confirmation Line

Before the user hits "+ เพิ่ม", consider showing a computed summary line:

> 4 แพ็ค × ฿255.00/แพ็ค = **฿1,020.00** รวม

This helps the user catch entry mistakes before submitting.

---

---

## Searchable Ingredient Dropdown

The "เลือกวัตถุดิบ..." dropdown currently shows a flat list of all ingredients with no filtering. Replace it with a **combobox** — a text input that filters the list as the user types.

### Behaviour

- User clicks the field → dropdown opens showing all ingredients
- User types letters → list filters to matching names in real time (case-insensitive, matches anywhere in the name)
- User clicks an item → it's selected and the field shows the ingredient name
- No new API call needed — filter the already-loaded list client-side

### Example

Typing "นม" narrows the list to only ingredients whose names contain "นม".

### Notes

- This is entirely client-side. The backend does not change.
- If the ingredient list ever grows very large (hundreds of items) and the initial load becomes slow, a server-side search endpoint can be added later. Not needed now.

---

## Receipt Detail View (Clicking a Confirmed Receipt)

Right now confirmed receipts are read-only dead ends. They should open a **detail view** showing everything that was in that receipt.

### What to show

Call `GET /api/v1/receipts/{id}` — the backend already returns the full lot list. Display:

| Column | Source field |
|---|---|
| วัตถุดิบ | `inventory_item_name` |
| จำนวนแพ็ค | `qty_packs` |
| ราคา/แพ็ค | `unit_price` |
| ราคารวม | `qty_packs × unit_price` (compute frontend) |
| วันหมดอายุ | `expiry_date` |

At the bottom of the lot table, show a **receipt total**:

> **รวมทั้งหมด: ฿X,XXX.XX**

Computed as `sum(qty_packs × unit_price)` across all lots.

### Notes

- No new API endpoint needed — `GET /api/v1/receipts/{id}` already exists and returns this data.
- Confirmed receipts are read-only; no edit/delete actions needed in this view.
- If you also want total price shown on the **receipt list cards** (before clicking in), that requires a backend change — `StockReceiptSummary` doesn't include lot data. Skip for now, show total only inside the detail view.

---

## Backend Contract (Unchanged)

The API payload and response are identical to what's documented in `receipt-lot-unit-price-handoff.md`. Both changes on this doc are purely frontend UX.
