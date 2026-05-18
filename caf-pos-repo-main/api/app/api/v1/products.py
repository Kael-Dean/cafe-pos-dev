from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.catalog import (
    ProductCreate,
    ProductDetail,
    ProductModifierGroupsReplace,
    ProductRead,
    ProductUpdate,
    RecipeBulkReplace,
    RecipeItemRead,
)
from app.services import catalog as svc

router = APIRouter(prefix="/products", tags=["catalog"])

_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get(
    "",
    response_model=list[ProductRead],
    summary="List products in the current store",
    operation_id="products_list",
)
async def list_products(
    user: StoreUser,
    db: DbSession,
    category_id: str | None = Query(None),
    is_active: bool | None = Query(True),
    search: str | None = Query(None, max_length=120),
) -> list[ProductRead]:
    rows = await svc.list_products(
        db,
        store_id=user.store_id,
        category_id=category_id,
        is_active=is_active,
        search=search,
    )
    return [ProductRead.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=ProductRead,
    status_code=201,
    summary="Create a product",
    operation_id="products_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_product(payload: ProductCreate, user: StoreUser, db: DbSession) -> ProductRead:
    product = await svc.create_product(db, store_id=user.store_id, payload=payload)
    return ProductRead.model_validate(product)


@router.get(
    "/{product_id}",
    response_model=ProductDetail,
    summary="Get a product with its recipe and modifier groups",
    operation_id="products_get",
)
async def get_product(product_id: str, user: StoreUser, db: DbSession) -> ProductDetail:
    return await svc.get_product_detail(db, store_id=user.store_id, product_id=product_id)


@router.patch(
    "/{product_id}",
    response_model=ProductRead,
    summary="Update product fields",
    operation_id="products_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_product(
    product_id: str, payload: ProductUpdate, user: StoreUser, db: DbSession
) -> ProductRead:
    product = await svc.update_product(
        db, store_id=user.store_id, product_id=product_id, payload=payload
    )
    return ProductRead.model_validate(product)


@router.delete(
    "/{product_id}",
    status_code=204,
    summary="Soft-delete a product (is_active=False)",
    operation_id="products_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_product(product_id: str, user: StoreUser, db: DbSession) -> None:
    await svc.delete_product(db, store_id=user.store_id, product_id=product_id)


@router.put(
    "/{product_id}/recipe",
    response_model=list[RecipeItemRead],
    summary="Bulk-replace the recipe (BOM) for a product",
    operation_id="products_replace_recipe",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def replace_recipe(
    product_id: str, payload: RecipeBulkReplace, user: StoreUser, db: DbSession
) -> list[RecipeItemRead]:
    return await svc.replace_recipe(
        db, store_id=user.store_id, product_id=product_id, payload=payload
    )


@router.put(
    "/{product_id}/modifier-groups",
    status_code=204,
    summary="Bulk attach/reorder modifier groups on a product",
    operation_id="products_replace_modifier_groups",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def replace_product_modifier_groups(
    product_id: str,
    payload: ProductModifierGroupsReplace,
    user: StoreUser,
    db: DbSession,
) -> None:
    await svc.replace_product_modifier_groups(
        db, store_id=user.store_id, product_id=product_id, payload=payload
    )
