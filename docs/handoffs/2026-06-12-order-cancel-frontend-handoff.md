# Frontend Handoff — Order Cancellation ("Cancel" / ยกเลิก)

**Date:** 2026-06-12
**Backend branch:** `feat/order-cancel-restock`
**Audience:** Frontend (cafe-pos-dev Vercel app)
**Design ref:** `docs/plans/2026-06-12-order-cancel-design.md`

---

## TL;DR

Staff can now cancel an order after it's placed. **The backend already does
everything** — keeps the order (never deletes), reverts stock, reverts money,
logs a reason, works at any stage. Your job is to **add the button + dialog**
that calls one existing endpoint and to listen to one realtime event.

> Naming note: the backend calls this **VOID** and the endpoint is `/void`.
> **Show the user "Cancel" / "ยกเลิก" everywhere — never the word "void".**
> Same concept, friendlier label.

---

## What changed on the backend

1. **`POST /orders/{id}/void` is now callable by any store role** (was
   Manager/Owner only). Baristas/bakers can cancel their own test/wrong orders.
2. **New optional `restock` field** on the request body. It controls what
   happens to ingredients:
   - `restock: true` (default) — order *not yet made*, ingredients go back into
     stock.
   - `restock: false` — order *already prepared*, ingredients are written off as
     **waste** (inventory stays down — it tells the truth).
3. **`order.voided` realtime event now includes `restock`** so the KDS can show
   the difference if you want.

Nothing else changed. Money was already handled: a canceled order automatically
disappears from revenue reports and from the cash-drawer expected total.

---

## The endpoint

```
POST /orders/{order_id}/void
Authorization: Bearer <access JWT>
Content-Type: application/json
```

**Request body**

| Field     | Type            | Required | Default | Meaning |
|-----------|-----------------|----------|---------|---------|
| `reason`  | string \| null  | No*      | `null`  | Why it was canceled. *Optional server-side, but the UI should require/strongly nudge it.* |
| `restock` | boolean         | No       | `true`  | `false` = order was already made → write ingredients off as waste. |

```json
{ "reason": "ลูกค้าสั่งผิด", "restock": false }
```

**Success — `200 OK`** returns the full updated order (`OrderRead`) with
`status: "VOID"`:

```json
{
  "id": "clx...",
  "order_number": 1042,
  "daily_number": 12,
  "business_date": "2026-06-12",
  "receipt_no": "IV25690612-0012",
  "store_id": "clx...",
  "status": "VOID",
  "channel": "DINE_IN",
  "payment_method": "CASH",
  "payment_ref": null,
  "customer_note": null,
  "subtotal": "170.00",
  "discount": "0.00",
  "tax": "0.00",
  "total": "170.00",
  "created_by_id": "clx...",
  "items": [ { "id": "...", "product_name": "Latte", "quantity": 2, "unit_price": "85.00", "line_total": "170.00", "modifiers_json": null } ],
  "created_at": "2026-06-12T08:01:00Z",
  "updated_at": "2026-06-12T08:14:00Z"
}
```

> Note: monetary fields come back as **strings** (Decimal) — parse accordingly.

**Errors** — envelope is always `{ "error": { "code", "message" } }`:

| Status | code         | When |
|--------|--------------|------|
| `409`  | `CONFLICT`   | Order is already canceled. message: `"Order is already voided"`. |
| `404`  | `NOT_FOUND`  | Order id doesn't exist in this store. |
| `401`  | `UNAUTHORIZED` | Missing/expired token. |

There is **no status restriction** — `PENDING`, `PAID`, `IN_PROGRESS`, `READY`,
and `COMPLETED` can all be canceled. Only a second cancel on an already-canceled
order fails (409).

---

## Realtime event (Pusher)

After a successful cancel, the backend publishes:

- **Channel:** `kds-store-{store_id}`
- **Event:** `order.voided`
- **Payload:**

```json
{ "order_id": "clx...", "voided_by": "clx...", "reason": "ลูกค้าสั่งผิด", "restock": false }
```

KDS screens subscribed to that channel should **remove or grey out** the ticket
on this event. Use `restock: false` to optionally badge it "ทำแล้ว/ทิ้ง"
(made & discarded) vs `true` "ยกเลิกก่อนทำ" (canceled before making).

---

## What the UI needs to build

1. **Cancel button**
   - On the order detail screen and on each KDS ticket.
   - Visible to all logged-in store roles (no role check needed — backend allows
     it). If you still want a manager-PIN step for after-payment cancels, that's
     a frontend policy decision; the API won't enforce it.

2. **Confirm dialog**
   - **Reason** input (text). Treat as required in the UI even though the API
     allows null — an empty reason makes the audit log useless.
   - **Toggle: "ทำเสร็จแล้ว? / Already made?"**
     - OFF (default) → send `restock: true` (ingredients return to stock).
     - ON → send `restock: false` (ingredients written off as waste).
   - Helper text: *"เปิดถ้าเครื่องดื่ม/อาหารถูกทำไปแล้ว — วัตถุดิบจะถูกบันทึกเป็นของเสีย"*
     (Turn on if the item was already prepared — ingredients will be recorded as waste.)

3. **Optimistic / post-action UI**
   - On `200`, set the order's local status to `VOID` and render it as
     **"ยกเลิกแล้ว / Canceled"**.
   - On `409`, the order was already canceled elsewhere — refresh it and show a
     soft notice rather than an error toast.

4. **History / receipts**
   - Keep canceled orders **visible** (struck-through + reason), don't hide
     them. They're excluded from sales/revenue automatically — you don't need to
     filter them out of totals yourself, but you may want to filter them out of
     "active orders" lists by `status !== "VOID"`.

---

## Example call (TypeScript / fetch)

```ts
async function cancelOrder(
  orderId: string,
  opts: { reason: string; alreadyMade: boolean },
  token: string,
) {
  const res = await fetch(`${API_BASE}/orders/${orderId}/void`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ reason: opts.reason, restock: !opts.alreadyMade }),
  });

  if (res.status === 409) {
    // Already canceled — re-sync this order and inform the user gently.
    return { alreadyCanceled: true as const };
  }
  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error?.message ?? "Cancel failed");
  }
  return { order: await res.json() }; // status === "VOID"
}
```

Mapping reminder: dialog toggle **"Already made?" = ON** → `restock: false`.

---

## QA checklist

- [ ] Cancel a `PENDING` order with toggle OFF → order shows Canceled, stock
      returns (check an item's on-hand in inventory).
- [ ] Cancel a `READY`/`COMPLETED` order with toggle ON → order shows Canceled,
      stock does **not** increase, and the item appears in the wastage report.
- [ ] Cancel a paid CASH order → cash-session expected total drops by the order
      total (verify in the cash reconciliation screen).
- [ ] Cancel twice → second attempt shows the "already canceled" soft notice
      (409), not a hard error.
- [ ] KDS ticket disappears/greys when another device cancels the same order
      (`order.voided` event).
- [ ] A barista (not manager) can cancel — button works, no 403.
