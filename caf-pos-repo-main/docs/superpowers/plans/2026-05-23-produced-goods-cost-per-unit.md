# Produced Goods Cost-Per-Unit Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a production order is committed, compute and persist `cost_per_unit` on the finished-goods `InventoryItem` so that PRODUCED products show the correct ingredient cost when used in another product's BOM.

**Architecture:** The fix is entirely inside `create_production_order` in `api/app/services/production.py`. While iterating recipe items to deduct stock, we accumulate the total ingredient cost; after the loop we divide by `units_produced` and write the result to `fg_item.cost_per_unit`. No schema changes, no new endpoints.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x async, pytest-asyncio, uv

---

## Background

`InventoryItem.cost_per_unit` (Numeric 10,4) is normally populated via stock receipts. PRODUCED goods are replenished via production runs (`PRODUCTION` movement type) — the receipt flow is never triggered, so `cost_per_unit` stays at `0.0000`. Any product whose BOM includes a PRODUCED ingredient therefore shows `฿0.00` for that line, making recipe cost and margin wrong.

### Correct formula

```
total_ingredient_cost  = Σ (recipe_item.quantity × batches_count × inv_item.cost_per_unit)
cost_per_serving       = total_ingredient_cost / units_produced
                       = total_ingredient_cost / (batches_count × servings_per_batch)
```

`cost_per_serving` is written to `fg_item.cost_per_unit` at the end of the atomic block.

---

## Files

| Action | Path |
|--------|------|
| Modify | `api/app/services/production.py` |
| Modify (add test) | `api/tests/test_production_api.py` |

No new files. No migrations (column already exists).

---

## Task 1: Write the failing test

**Files:**
- Modify: `api/tests/test_production_api.py`

- [ ] **Step 1: Add the failing test at the bottom of the service-layer block (after line 72, before the first `# API-layer` comment)**

```python
async def test_create_production_order_sets_cost_per_unit_on_finished_goods(
    db, store_a, user_a
):
    """cost_per_unit on the finished-goods item must equal total ingredient cost / units_produced."""
    from decimal import Decimal

    from sqlalchemy import select

    from app.models.catalog import RecipeItem
    from app.models.inventory import InventoryItem
    from app.schemas.production import ProductionOrderCreate
    from app.services import production as svc

    # Arrange: flour at ฿0.50/g, sugar at ฿0.20/g
    flour = await make_item(
        db, store_id=store_a.id, name=f"Flour-cost-{uid()}", unit="g", stock=Decimal("2000")
    )
    flour.cost_per_unit = Decimal("0.5000")
    await db.commit()

    sugar = await make_item(
        db, store_id=store_a.id, name=f"Sugar-cost-{uid()}", unit="g", stock=Decimal("1000")
    )
    sugar.cost_per_unit = Decimal("0.2000")
    await db.commit()

    cookies = await make_produced_product(
        db, store_id=store_a.id, name=f"CostCookie-{uid()}", servings_per_batch=10
    )

    # Recipe: 100g flour + 50g sugar per batch
    db.add(RecipeItem(product_id=cookies.id, inventory_item_id=flour.id, quantity=Decimal("100")))
    db.add(RecipeItem(product_id=cookies.id, inventory_item_id=sugar.id, quantity=Decimal("50")))
    await db.commit()

    # Act: run 2 batches → 20 units
    payload = ProductionOrderCreate(product_id=cookies.id, batches_count=2)
    await svc.create_production_order(
        db, store_id=store_a.id, user_id=user_a.id, payload=payload
    )

    # Assert:
    # total cost = (100g × 2 batches × 0.50) + (50g × 2 batches × 0.20)
    #            = 100 + 20 = 120
    # cost_per_serving = 120 / 20 = 6.0000
    fg_result = await db.execute(
        select(InventoryItem).where(InventoryItem.id == cookies.finished_goods_item_id)
    )
    fg = fg_result.scalar_one()
    await db.refresh(fg)
    assert fg.cost_per_unit == Decimal("6.0000")
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd api
uv run pytest tests/test_production_api.py::test_create_production_order_sets_cost_per_unit_on_finished_goods -v
```

Expected output: `FAILED` — `AssertionError: assert Decimal('0') == Decimal('6.0000')`

---

## Task 2: Implement the fix

**Files:**
- Modify: `api/app/services/production.py`

- [ ] **Step 1: Replace the body of `create_production_order` with the updated version**

The only changes are:
1. Initialize `total_ingredient_cost = Decimal("0")` before the recipe loop.
2. Inside the loop, accumulate cost when `inv_item` is found.
3. After the finished-goods stock update, set `fg_item.cost_per_unit`.

Replace the entire function (lines 16–77) with:

```python
async def create_production_order(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: ProductionOrderCreate,
) -> ProductionOrder:
    async with db.begin():
        product = await _load_produced_product(db, store_id=store_id, product_id=payload.product_id)

        recipe_result = await db.execute(
            select(RecipeItem).where(RecipeItem.product_id == product.id)
        )
        recipe_items = list(recipe_result.scalars())

        units_produced = payload.batches_count * product.servings_per_batch

        total_ingredient_cost = Decimal("0")
        for ri in recipe_items:
            total_qty = ri.quantity * payload.batches_count
            item_result = await db.execute(
                select(InventoryItem).where(InventoryItem.id == ri.inventory_item_id)
            )
            inv_item = item_result.scalar_one_or_none()
            if inv_item:
                inv_item.stock_on_hand -= total_qty
                total_ingredient_cost += total_qty * inv_item.cost_per_unit
            db.add(StockMovement(
                store_id=store_id,
                inventory_item_id=ri.inventory_item_id,
                type=MovementType.PRODUCTION_USE,
                quantity=total_qty,
                reason=f"Production: {product.name} ×{payload.batches_count}",
                created_by_id=user_id,
            ))

        fg_result = await db.execute(
            select(InventoryItem).where(InventoryItem.id == product.finished_goods_item_id)
        )
        fg_item = fg_result.scalar_one_or_none()
        if fg_item:
            fg_item.stock_on_hand += Decimal(str(units_produced))
            if units_produced:
                fg_item.cost_per_unit = total_ingredient_cost / Decimal(str(units_produced))
        db.add(StockMovement(
            store_id=store_id,
            inventory_item_id=product.finished_goods_item_id,
            type=MovementType.PRODUCTION,
            quantity=Decimal(str(units_produced)),
            reason=f"Production: {product.name} ×{payload.batches_count}",
            created_by_id=user_id,
        ))

        order = ProductionOrder(
            store_id=store_id,
            product_id=product.id,
            batches_count=payload.batches_count,
            units_produced=units_produced,
            produced_by=user_id,
            notes=payload.notes,
        )
        db.add(order)
        await db.flush()
        await db.refresh(order)

    return order
```

- [ ] **Step 2: Run the new test to confirm it passes**

```bash
cd api
uv run pytest tests/test_production_api.py::test_create_production_order_sets_cost_per_unit_on_finished_goods -v
```

Expected output: `PASSED`

- [ ] **Step 3: Run the full production test suite to confirm no regressions**

```bash
cd api
uv run pytest tests/test_production_api.py -v
```

Expected output: all tests `PASSED` (currently 6 tests).

- [ ] **Step 4: Run the full test suite**

```bash
cd api
uv run pytest
```

Expected output: all tests pass. If any unrelated tests fail, investigate before proceeding.

- [ ] **Step 5: Commit**

```bash
git add api/app/services/production.py api/tests/test_production_api.py
git commit -m "fix: persist cost_per_unit on finished-goods item after production run"
```

---

## Verification

After the fix, every time a production order is submitted:

- `fg_item.cost_per_unit` = `total ingredient cost for all batches` ÷ `units_produced`
- Any other product's BOM that lists this PRODUCED good as an ingredient will now read a non-zero `cost_per_unit` from the inventory item, making recipe cost and margin calculations correct.

If a PRODUCED product has **no recipe items** (empty BOM), `total_ingredient_cost` stays `0` and `cost_per_unit` is set to `0` — correct behaviour, and consistent with the existing note in the handoff doc ("a production run will still succeed — it just adds finished goods without consuming any ingredients").
