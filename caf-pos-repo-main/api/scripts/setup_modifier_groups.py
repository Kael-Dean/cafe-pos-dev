"""One-time modifier group setup for drink products.

Run with: `uv run python scripts/setup_modifier_groups.py`

Creates (idempotent — skips if already present by name):
- ModifierGroup: "ความหวาน" (Sweetness) with 4 options
- ModifierGroup: "ขนาด" (Size) with 3 options (S/M/L with price deltas)

Then links both groups to every active product whose category name does NOT
contain any of: bakery, bake, food, snack, cake (case-insensitive).
Products with no category are linked (assumed to be drinks).

Safe to re-run — existing product_modifier_groups rows are skipped.
"""
import asyncio
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_maker, engine
from app.models.catalog import Category, Modifier, ModifierGroup, Product, ProductModifierGroup
from app.models.tenancy import Store

STORE_SLUG = "sukhumvit-49"

FOOD_KEYWORDS = {"bakery", "bake", "food", "snack", "cake"}

SWEETNESS_GROUP = {
    "name": "ความหวาน",
    "required": False,
    "min_select": 0,
    "max_select": 1,
    "modifiers": [
        {"name": "ไม่หวาน", "price_delta": Decimal("0"), "sort_order": 1},
        {"name": "น้อย",    "price_delta": Decimal("0"), "sort_order": 2},
        {"name": "ปกติ",    "price_delta": Decimal("0"), "sort_order": 3},
        {"name": "มาก",     "price_delta": Decimal("0"), "sort_order": 4},
    ],
}

SIZE_GROUP = {
    "name": "ขนาด",
    "required": True,
    "min_select": 1,
    "max_select": 1,
    "modifiers": [
        {"name": "S", "price_delta": Decimal("-5"),  "sort_order": 1},
        {"name": "M", "price_delta": Decimal("0"),   "sort_order": 2},
        {"name": "L", "price_delta": Decimal("10"),  "sort_order": 3},
    ],
}


async def setup() -> None:
    async with async_session_maker() as db:
        store = await _get_store(db)
        if not store:
            print(f"Store '{STORE_SLUG}' not found. Run seed.py first.")
            return

        sweetness = await _ensure_group(db, store.id, SWEETNESS_GROUP)
        size = await _ensure_group(db, store.id, SIZE_GROUP)

        linked, skipped = await _link_drinks(db, store.id, [sweetness.id, size.id])
        print(f"\nLinked {linked} product(s), skipped {skipped} (food category or already linked).")

    await engine.dispose()
    print("Setup complete.")


async def _get_store(db: AsyncSession) -> Store | None:
    result = await db.execute(select(Store).where(Store.slug == STORE_SLUG))
    return result.scalar_one_or_none()


async def _ensure_group(db: AsyncSession, store_id: str, spec: dict) -> ModifierGroup:
    async with db.begin():
        result = await db.execute(
            select(ModifierGroup).where(
                ModifierGroup.store_id == store_id,
                ModifierGroup.name == spec["name"],
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            print(f"  Group '{spec['name']}' already exists — skipping.")
            return existing

        group = ModifierGroup(
            store_id=store_id,
            name=spec["name"],
            required=spec["required"],
            min_select=spec["min_select"],
            max_select=spec["max_select"],
            is_active=True,
        )
        db.add(group)
        await db.flush()

        for m in spec["modifiers"]:
            db.add(
                Modifier(
                    group_id=group.id,
                    name=m["name"],
                    price_delta=m["price_delta"],
                    sort_order=m["sort_order"],
                    is_active=True,
                )
            )

    print(f"  Created group '{spec['name']}' with {len(spec['modifiers'])} modifiers.")
    return group


async def _is_food_category(db: AsyncSession, category_id: str | None) -> bool:
    if category_id is None:
        return False
    result = await db.execute(select(Category.name).where(Category.id == category_id))
    name = result.scalar_one_or_none()
    if name is None:
        return False
    return any(kw in name.lower() for kw in FOOD_KEYWORDS)


async def _link_drinks(
    db: AsyncSession, store_id: str, group_ids: list[str]
) -> tuple[int, int]:
    result = await db.execute(
        select(Product).where(Product.store_id == store_id, Product.is_active == True)
    )
    products = result.scalars().all()

    linked = skipped = 0
    for product in products:
        if await _is_food_category(db, product.category_id):
            print(f"  Skipping '{product.name}' (food category).")
            skipped += 1
            continue

        any_linked = False
        for sort_order, group_id in enumerate(group_ids):
            async with db.begin():
                exists = await db.execute(
                    select(ProductModifierGroup).where(
                        ProductModifierGroup.product_id == product.id,
                        ProductModifierGroup.modifier_group_id == group_id,
                    )
                )
                if exists.scalar_one_or_none():
                    continue
                db.add(
                    ProductModifierGroup(
                        product_id=product.id,
                        modifier_group_id=group_id,
                        sort_order=sort_order,
                    )
                )
                any_linked = True

        if any_linked:
            print(f"  Linked '{product.name}' to {len(group_ids)} group(s).")
            linked += 1
        else:
            print(f"  '{product.name}' already linked — skipping.")
            skipped += 1

    return linked, skipped


if __name__ == "__main__":
    asyncio.run(setup())
