import logging

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.models.catalog import (
    Category,
    Modifier,
    ModifierGroup,
    Product,
    ProductModifierGroup,
    RecipeItem,
)
from app.schemas.catalog import (
    CategoryCreate,
    CategoryUpdate,
    ModifierCreate,
    ModifierGroupCreate,
    ModifierGroupRead,
    ModifierGroupUpdate,
    ModifierRead,
    ProductCreate,
    ProductDetail,
    ProductModifierGroupsReplace,
    ProductRead,
    ProductUpdate,
    RecipeBulkReplace,
    RecipeItemRead,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


async def list_categories(db: AsyncSession, *, store_id: str) -> list[Category]:
    result = await db.execute(
        select(Category)
        .where(Category.store_id == store_id)
        .order_by(Category.sort_order, Category.name)
    )
    return list(result.scalars())


async def create_category(db: AsyncSession, *, store_id: str, payload: CategoryCreate) -> Category:
    async with db.begin():
        cat = Category(store_id=store_id, name=payload.name, sort_order=payload.sort_order)
        db.add(cat)
    return cat


async def update_category(
    db: AsyncSession, *, store_id: str, category_id: str, payload: CategoryUpdate
) -> Category:
    async with db.begin():
        cat = await _load_category(db, store_id=store_id, category_id=category_id)
        if payload.name is not None:
            cat.name = payload.name
        if payload.sort_order is not None:
            cat.sort_order = payload.sort_order
    return cat


async def delete_category(db: AsyncSession, *, store_id: str, category_id: str) -> None:
    async with db.begin():
        cat = await _load_category(db, store_id=store_id, category_id=category_id)
        result = await db.execute(
            select(Product.id)
            .where(Product.category_id == category_id, Product.is_active.is_(True))
            .limit(1)
        )
        if result.scalar_one_or_none():
            raise Conflict("Category has active products — reassign or deactivate them first")
        cat.is_active = False


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------


async def list_products(
    db: AsyncSession,
    *,
    store_id: str,
    category_id: str | None = None,
    is_active: bool | None = True,
    search: str | None = None,
) -> list[Product]:
    stmt = select(Product).where(Product.store_id == store_id).order_by(Product.name)
    if is_active is not None:
        stmt = stmt.where(Product.is_active.is_(is_active))
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    if search:
        stmt = stmt.where(Product.name.ilike(f"%{search}%"))
    result = await db.execute(stmt)
    return list(result.scalars())


async def get_product_detail(
    db: AsyncSession, *, store_id: str, product_id: str
) -> ProductDetail:
    product = await _load_product(db, store_id=store_id, product_id=product_id)

    r = await db.execute(select(RecipeItem).where(RecipeItem.product_id == product.id))
    recipe_items = list(r.scalars())

    r = await db.execute(
        select(ModifierGroup)
        .join(ProductModifierGroup, ProductModifierGroup.modifier_group_id == ModifierGroup.id)
        .where(ProductModifierGroup.product_id == product.id, ModifierGroup.is_active.is_(True))
        .order_by(ProductModifierGroup.sort_order)
    )
    groups = list(r.scalars())

    mods_by_group: dict[str, list[Modifier]] = {}
    if groups:
        group_ids = [g.id for g in groups]
        r = await db.execute(
            select(Modifier)
            .where(Modifier.group_id.in_(group_ids), Modifier.is_active.is_(True))
            .order_by(Modifier.sort_order)
        )
        for mod in r.scalars():
            mods_by_group.setdefault(mod.group_id, []).append(mod)

    return ProductDetail(
        id=product.id,
        store_id=product.store_id,
        category_id=product.category_id,
        name=product.name,
        description=product.description,
        price=product.price,
        is_active=product.is_active,
        created_at=product.created_at,
        updated_at=product.updated_at,
        recipe=[RecipeItemRead.model_validate(ri) for ri in recipe_items],
        modifier_groups=[
            _build_group_read(g, mods_by_group.get(g.id, []))
            for g in groups
        ],
    )


async def create_product(
    db: AsyncSession, *, store_id: str, payload: ProductCreate
) -> Product:
    async with db.begin():
        if payload.category_id:
            await _load_category(db, store_id=store_id, category_id=payload.category_id)
        product = Product(
            store_id=store_id,
            category_id=payload.category_id,
            name=payload.name,
            description=payload.description,
            price=payload.price,
            is_active=payload.is_active,
        )
        db.add(product)
    return product


async def update_product(
    db: AsyncSession, *, store_id: str, product_id: str, payload: ProductUpdate
) -> Product:
    async with db.begin():
        product = await _load_product(db, store_id=store_id, product_id=product_id)
        if "category_id" in payload.model_fields_set:
            if payload.category_id:
                await _load_category(db, store_id=store_id, category_id=payload.category_id)
            product.category_id = payload.category_id
        for field in payload.model_fields_set - {"category_id"}:
            setattr(product, field, getattr(payload, field))
    return product


async def delete_product(
    db: AsyncSession, *, store_id: str, product_id: str
) -> None:
    async with db.begin():
        product = await _load_product(db, store_id=store_id, product_id=product_id)
        product.is_active = False


# ---------------------------------------------------------------------------
# Recipe (BOM)
# ---------------------------------------------------------------------------


async def replace_recipe(
    db: AsyncSession, *, store_id: str, product_id: str, payload: RecipeBulkReplace
) -> list[RecipeItemRead]:
    async with db.begin():
        await _load_product(db, store_id=store_id, product_id=product_id)
        await db.execute(delete(RecipeItem).where(RecipeItem.product_id == product_id))
        new_items = [
            RecipeItem(
                product_id=product_id,
                inventory_item_id=item.inventory_item_id,
                quantity=item.quantity,
            )
            for item in payload.items
        ]
        db.add_all(new_items)
    return [
        RecipeItemRead(id=ri.id, inventory_item_id=ri.inventory_item_id, quantity=ri.quantity)
        for ri in new_items
    ]


# ---------------------------------------------------------------------------
# Modifier Groups
# ---------------------------------------------------------------------------


async def list_modifier_groups(
    db: AsyncSession, *, store_id: str, is_active: bool | None = True
) -> list[ModifierGroupRead]:
    stmt = select(ModifierGroup).where(ModifierGroup.store_id == store_id).order_by(ModifierGroup.name)
    if is_active is not None:
        stmt = stmt.where(ModifierGroup.is_active.is_(is_active))
    result = await db.execute(stmt)
    groups = list(result.scalars())
    return await _load_groups_with_modifiers(db, groups)


async def create_modifier_group(
    db: AsyncSession, *, store_id: str, payload: ModifierGroupCreate
) -> ModifierGroupRead:
    async with db.begin():
        group = ModifierGroup(
            store_id=store_id,
            name=payload.name,
            required=payload.required,
            min_select=payload.min_select,
            max_select=payload.max_select,
        )
        db.add(group)
        await db.flush()
        modifiers = _build_modifiers(group.id, payload.modifiers)
        db.add_all(modifiers)
    return _build_group_read(group, modifiers)


async def update_modifier_group(
    db: AsyncSession, *, store_id: str, group_id: str, payload: ModifierGroupUpdate
) -> ModifierGroupRead:
    async with db.begin():
        group = await _load_modifier_group(db, store_id=store_id, group_id=group_id)
        for field in payload.model_fields_set - {"modifiers"}:
            setattr(group, field, getattr(payload, field))

        if "modifiers" in payload.model_fields_set and payload.modifiers is not None:
            await db.execute(delete(Modifier).where(Modifier.group_id == group.id))
            modifiers = _build_modifiers(group.id, payload.modifiers)
            db.add_all(modifiers)
        else:
            r = await db.execute(
                select(Modifier)
                .where(Modifier.group_id == group.id)
                .order_by(Modifier.sort_order)
            )
            modifiers = list(r.scalars())
    return _build_group_read(group, modifiers)


async def delete_modifier_group(
    db: AsyncSession, *, store_id: str, group_id: str
) -> None:
    async with db.begin():
        group = await _load_modifier_group(db, store_id=store_id, group_id=group_id)
        group.is_active = False
        await db.execute(
            delete(Modifier).where(Modifier.group_id == group.id)
        )


# ---------------------------------------------------------------------------
# Product ↔ ModifierGroup links
# ---------------------------------------------------------------------------


async def replace_product_modifier_groups(
    db: AsyncSession,
    *,
    store_id: str,
    product_id: str,
    payload: ProductModifierGroupsReplace,
) -> None:
    async with db.begin():
        await _load_product(db, store_id=store_id, product_id=product_id)
        await db.execute(
            delete(ProductModifierGroup).where(ProductModifierGroup.product_id == product_id)
        )
        links = [
            ProductModifierGroup(
                product_id=product_id,
                modifier_group_id=group_id,
                sort_order=idx,
            )
            for idx, group_id in enumerate(payload.modifier_group_ids)
        ]
        db.add_all(links)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


async def _load_category(
    db: AsyncSession, *, store_id: str, category_id: str
) -> Category:
    result = await db.execute(
        select(Category).where(Category.id == category_id, Category.store_id == store_id)
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise NotFound("Category not found")
    return cat


async def _load_product(
    db: AsyncSession, *, store_id: str, product_id: str
) -> Product:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.store_id == store_id)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise NotFound("Product not found")
    return product


async def _load_modifier_group(
    db: AsyncSession, *, store_id: str, group_id: str
) -> ModifierGroup:
    result = await db.execute(
        select(ModifierGroup).where(
            ModifierGroup.id == group_id, ModifierGroup.store_id == store_id
        )
    )
    group = result.scalar_one_or_none()
    if not group:
        raise NotFound("Modifier group not found")
    return group


async def _load_groups_with_modifiers(
    db: AsyncSession, groups: list[ModifierGroup]
) -> list[ModifierGroupRead]:
    if not groups:
        return []
    group_ids = [g.id for g in groups]
    r = await db.execute(
        select(Modifier)
        .where(Modifier.group_id.in_(group_ids))
        .order_by(Modifier.sort_order)
    )
    mods_by_group: dict[str, list[Modifier]] = {}
    for mod in r.scalars():
        mods_by_group.setdefault(mod.group_id, []).append(mod)
    return [_build_group_read(g, mods_by_group.get(g.id, [])) for g in groups]


def _build_group_read(
    group: ModifierGroup, modifiers: list[Modifier]
) -> ModifierGroupRead:
    return ModifierGroupRead(
        id=group.id,
        store_id=group.store_id,
        name=group.name,
        required=group.required,
        min_select=group.min_select,
        max_select=group.max_select,
        is_active=group.is_active,
        modifiers=[ModifierRead.model_validate(m) for m in modifiers],
    )


def _build_modifiers(group_id: str, specs: list[ModifierCreate]) -> list[Modifier]:
    return [
        Modifier(
            group_id=group_id,
            name=m.name,
            price_delta=m.price_delta,
            inventory_item_id=m.inventory_item_id,
            inventory_qty=m.inventory_qty,
            sort_order=m.sort_order,
        )
        for m in specs
    ]
