Backend Handoff — Drink Options Setup
Context
The POS frontend decides whether to show an options modal (sweetness, size, etc.) by checking a single flag when a product is tapped:


GET /api/v1/products/{product_id}
→ if response.modifier_groups.length > 0  →  show options modal
→ else                                     →  add directly to cart
The modal itself always displays the store-wide modifier groups from GET /api/v1/modifier-groups. No frontend changes are needed.

Step 1 — Create the store's modifier groups (one-time setup)
POST /api/v1/modifier-groups for each group:

Sweetness


{
  "name": "ความหวาน",
  "required": false,
  "min_select": 0,
  "max_select": 1,
  "is_active": true,
  "modifiers": [
    { "name": "ไม่หวาน", "price_delta": 0, "sort_order": 1, "is_active": true },
    { "name": "น้อย",    "price_delta": 0, "sort_order": 2, "is_active": true },
    { "name": "ปกติ",    "price_delta": 0, "sort_order": 3, "is_active": true },
    { "name": "มาก",     "price_delta": 0, "sort_order": 4, "is_active": true }
  ]
}
Size (example with price delta)


{
  "name": "ขนาด",
  "required": true,
  "min_select": 1,
  "max_select": 1,
  "is_active": true,
  "modifiers": [
    { "name": "S", "price_delta": -5,  "sort_order": 1, "is_active": true },
    { "name": "M", "price_delta": 0,   "sort_order": 2, "is_active": true },
    { "name": "L", "price_delta": 10,  "sort_order": 3, "is_active": true }
  ]
}
Rule: max_select: 1 → renders as radio buttons (single-select). max_select: null or > 1 → renders as checkboxes.

Save the id returned from each response.

Step 2 — Link modifier groups to every drink product
For each beverage product, call:

PUT /api/v1/products/{product_id}/modifier-groups


{
  "modifier_group_ids": ["<sweetness_group_id>", "<size_group_id>"]
}
The list order controls display order in the modal.
Bakery/food items: do not call this endpoint (empty modifier_groups = add directly to cart).
This endpoint is idempotent — safe to call again to reorder or update the linked groups.