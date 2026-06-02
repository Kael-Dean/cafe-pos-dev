from fastapi import APIRouter, Depends

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.catalog import CategoryCreate, CategoryRead, CategoryUpdate
from app.services import catalog as svc

router = APIRouter(prefix="/categories", tags=["catalog"])

_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get(
    "",
    response_model=list[CategoryRead],
    summary="List categories for the current store",
    operation_id="categories_list",
)
async def list_categories(user: StoreUser, db: DbSession) -> list[CategoryRead]:
    rows = await svc.list_categories(db, store_id=user.store_id)
    return [CategoryRead.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=CategoryRead,
    status_code=201,
    summary="Create a category",
    operation_id="categories_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_category(payload: CategoryCreate, user: StoreUser, db: DbSession) -> CategoryRead:
    cat = await svc.create_category(db, store_id=user.store_id, payload=payload)
    return CategoryRead.model_validate(cat)


@router.patch(
    "/{category_id}",
    response_model=CategoryRead,
    summary="Rename or re-sort a category",
    operation_id="categories_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_category(
    category_id: str, payload: CategoryUpdate, user: StoreUser, db: DbSession
) -> CategoryRead:
    cat = await svc.update_category(
        db, store_id=user.store_id, category_id=category_id, payload=payload
    )
    return CategoryRead.model_validate(cat)


@router.delete(
    "/{category_id}",
    status_code=204,
    summary="Soft-delete a category (refused if active products are attached)",
    operation_id="categories_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_category(category_id: str, user: StoreUser, db: DbSession) -> None:
    await svc.delete_category(db, store_id=user.store_id, category_id=category_id)
