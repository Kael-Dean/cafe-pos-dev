# API Handoff: COMPONENT Product Type (produce-only ingredients)

## Business Context
We added a third kind of product: **COMPONENT** — an ingredient the cafe **makes in-house to be consumed by other menu items**, never sold to customers (e.g. a caramel sauce, a dough base, a syrup). It behaves like the existing `PRODUCED` type (it's made via a production order and lands in inventory so other recipes can use it), but it is **not sellable**: it has no sell price and must never appear on the POS/order screen. Its "cost" is the cost of its ingredients, computed by the backend.

The product types are now:
- `MADE_TO_ORDER` — assembled per order from raw ingredients (existing).
- `PRODUCED` — batch-produced finished good that **is** sold (existing).
- `COMPONENT` — **new**, batch-produced ingredient that is **not** sold.

## What the frontend needs to change (summary)
1. **BOM builder — add a "Component" creation flow** that does NOT ask for a sell price. Set `product_type: "COMPONENT"` and omit `price`.
2. **Sales / POS / order screen — exclude components.** Fetch sellable products with `GET /products?product_type=...` (or filter out `product_type === "COMPONENT"`). The backend also hard-blocks ordering a component (422), but the UI should never offer one.
3. **Component menu in the BOM builder** — list components with `GET /products?product_type=COMPONENT`.
4. **Show cost, not price, for components** — read the new `estimated_unit_cost` field from `GET /products/{id}` (product detail). Do not show/edit a sell price for components.
5. **Recipe builder** — a component's produced stock is an inventory item (`finished_goods_item_id`); it is already selectable as a recipe ingredient of other products like any inventory item. No special handling needed beyond letting users pick it.
6. **Production screen** — allow selecting `COMPONENT` products to produce (same flow as `PRODUCED`).

## Endpoints

### POST /products
- **Purpose**: Create a product. Now supports `product_type: "COMPONENT"`.
- **Auth**: OWNER or MANAGER.
- **Request**:
  ```json
  {
    "category_id": "string|null — optional",
    "name": "string — required, 1–120 chars",
    "description": "string|null — optional, ≤500 chars",
    "price": "decimal — REQUIRED for MADE_TO_ORDER/PRODUCED; OMIT for COMPONENT (forced to 0)",
    "is_active": "bool — default true",
    "product_type": "MADE_TO_ORDER | PRODUCED | COMPONENT — default MADE_TO_ORDER",
    "servings_per_batch": "int — default 1, ≥1 (units produced per batch for PRODUCED/COMPONENT)"
  }
  ```
  Example (component):
  ```json
  { "name": "Caramel Sauce", "product_type": "COMPONENT", "servings_per_batch": 4 }
  ```
- **Response** (201): a `ProductRead` (see Data Models). For a COMPONENT, `price` is `0` and `finished_goods_item_id` is auto-populated.
- **Response** (error):
  - `422 UNPROCESSABLE_ENTITY` — validation. **Notably: creating a `MADE_TO_ORDER`/`PRODUCED` product with no `price` fails** ("price is required for sellable products"). Creating a `COMPONENT` with no price succeeds.
  - `403 FORBIDDEN` — not OWNER/MANAGER.
- **Notes**: For a COMPONENT (and PRODUCED), the backend auto-creates a linked inventory item; you do not create it.

### PATCH /products/{product_id}
- **Purpose**: Update product fields, including switching `product_type`.
- **Auth**: OWNER or MANAGER.
- **Request**: any subset of the create fields (all optional).
- **Behavior to know**:
  - Switching a product **to** `COMPONENT` (or `PRODUCED`) auto-creates its finished-goods inventory item if absent.
  - Switching to `COMPONENT` forces `price` to `0`. Sending a `price` on an existing COMPONENT is also coerced to `0` — the UI should just hide the price field for components.
  - Switching to `MADE_TO_ORDER` clears `finished_goods_item_id`.
- **Response** (200): `ProductRead`.

### GET /products
- **Purpose**: List products. **New optional `product_type` filter.**
- **Auth**: any store user.
- **Query params**: `category_id?`, `is_active?` (default `true`), `search?` (≤120 chars), **`product_type?`** (`MADE_TO_ORDER|PRODUCED|COMPONENT`).
- **Response** (200): `ProductRead[]`.
- **Notes**: Omitting `product_type` returns all types (unchanged behavior). Use `?product_type=COMPONENT` for the component menu; to build the sales screen, fetch the sellable types or filter out components client-side.

### GET /products/{product_id}
- **Purpose**: Product detail with recipe + modifier groups. **Now includes `estimated_unit_cost`.**
- **Auth**: any store user.
- **Response** (200): `ProductDetail` (see Data Models). `estimated_unit_cost` = computed per-unit ingredient cost (this is the component's "cost = cost of ingredients").

### POST /production/orders  (existing endpoint — now accepts COMPONENT)
- **Purpose**: Record a production run (consume recipe ingredients → add finished stock).
- **Auth**: as today (unchanged).
- **Request**:
  ```json
  {
    "product_id": "string — must be a PRODUCED or COMPONENT product",
    "batches_count": "int — ≥1",
    "notes": "string|null — optional"
  }
  ```
- **Response**: production order record (unchanged shape).
- **Notes**: Previously rejected anything that wasn't `PRODUCED`; now `COMPONENT` is allowed too. Producing a component adds `batches_count × servings_per_batch` units to its inventory item.

### Order creation (POS) — COMPONENT is blocked
- Adding a `COMPONENT` product to an order is rejected with **`422 UNPROCESSABLE_ENTITY`**, message `"Product is not sellable"`. The frontend should never let a component reach the cart; this is a backstop, not a UX path.

## Data Models / DTOs

```typescript
type ProductType = 'MADE_TO_ORDER' | 'PRODUCED' | 'COMPONENT';

interface ProductRead {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  price: string;              // Decimal serialized; always "0" for COMPONENT
  is_active: boolean;
  product_type: ProductType;  // NEW value: 'COMPONENT'
  servings_per_batch: number;
  finished_goods_item_id: string | null; // set for PRODUCED & COMPONENT
  created_at: string;         // ISO 8601
  updated_at: string;         // ISO 8601
}

interface RecipeItemRead {
  id: string;
  inventory_item_id: string;
  quantity: string;           // Decimal
  cost_per_unit: string;      // Decimal
}

interface ProductDetail extends ProductRead {
  recipe: RecipeItemRead[];
  modifier_groups: ModifierGroupRead[];
  estimated_unit_cost: string; // NEW — Decimal, per-unit ingredient cost
}
```

> Decimals are serialized as JSON; treat money/quantities as strings and parse, don't rely on JS number precision.

## Enums & Constants

| `product_type` | Meaning | Sellable? | Made via production order? | Display label (suggested) |
|----------------|---------|-----------|----------------------------|---------------------------|
| `MADE_TO_ORDER` | Assembled per order | Yes | No | Made to order |
| `PRODUCED` | Batch-produced finished good, sold | Yes | Yes | Produced good |
| `COMPONENT` | Batch-produced ingredient, **not sold** | **No** | Yes | Component / Prep item |

## Validation Rules (mirror in UI)
- `name`: required, 1–120 chars.
- `price`: required for `MADE_TO_ORDER`/`PRODUCED`; **hidden/omitted for `COMPONENT`** (server forces 0). ≥0, ≤999999.99.
- `servings_per_batch`: integer ≥1 (relevant for PRODUCED/COMPONENT — units yielded per batch).
- `description`: ≤500 chars.

## Business Logic & Edge Cases
- A COMPONENT always has `price === "0"` regardless of what you send — don't display it as a sellable price.
- A COMPONENT (and PRODUCED) automatically owns a finished-goods inventory item (`finished_goods_item_id`); that item is what other recipes consume. You don't create or manage it directly.
- `estimated_unit_cost` is **derived live** from the current recipe and ingredient costs every time you GET the detail — it can change as ingredient costs change, and is `0` until the recipe has ingredients with costs. It is not stored/editable.
- Components are excluded from sales by policy; the order API enforces it (422). Build the sales catalog from non-component types.
- Duplicating a COMPONENT (`POST /products/{id}/duplicate`) also gives the copy its own finished-goods inventory item.

## Integration Notes
- **Recommended flows**:
  - *Create component*: BOM builder → "New component" (no price field) → `POST /products {product_type:"COMPONENT", name, servings_per_batch}` → then set its recipe via the existing `PUT /products/{id}/recipe`.
  - *Use component in a menu item*: in another product's recipe builder, the component's inventory item is selectable like any ingredient.
  - *Produce a component*: production screen → pick a COMPONENT → `POST /production/orders {product_id, batches_count}`.
  - *Sales screen*: `GET /products?product_type=MADE_TO_ORDER` and/or `PRODUCED`, or fetch all and filter out `COMPONENT`.
- **Optimistic UI**: fine for create/update; for `estimated_unit_cost`, re-fetch the detail after editing the recipe rather than computing client-side.
- **Real-time/caching**: unchanged from existing product endpoints.

## Test Scenarios
1. **Create component (happy path)**: `POST /products {name, product_type:"COMPONENT"}` with no price → 201, response `price:"0"`, `finished_goods_item_id` set.
2. **Sellable requires price**: `POST /products {name, product_type:"MADE_TO_ORDER"}` with no price → 422 (`UNPROCESSABLE_ENTITY`).
3. **Component menu**: `GET /products?product_type=COMPONENT` → only components.
4. **Cost display**: `GET /products/{componentId}` → `estimated_unit_cost` reflects recipe ingredient cost ÷ servings_per_batch.
5. **Produce a component**: `POST /production/orders {product_id: componentId, batches_count: 1}` → succeeds; component stock increases.
6. **Cannot sell a component**: attempt to order a component → 422, message `"Product is not sellable"`.
7. **Switch type**: PATCH a MADE_TO_ORDER product to `product_type:"COMPONENT"` → response shows `finished_goods_item_id` populated and `price:"0"`.

## Open Questions / TODOs
- Confirm the desired UI label for `COMPONENT` ("Component" vs "Prep item" vs "Ingredient") — backend value is fixed as `COMPONENT`.
- The deployed `org/dev` build includes this; verify the `0030` migration ran on the dev environment before testing.
