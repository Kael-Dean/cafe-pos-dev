from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.inventory import (
    AdjustRequest,
    InventoryItemCreate,
    InventoryItemRead,
    InventoryItemUpdate,
    MovementsPage,
    ReceiveStockRequest,
    WasteRequest,
)
from app.services import inventory as inv

router = APIRouter(prefix="/inventory", tags=["inventory"])

_BARISTA_PLUS = require_role(Role.OWNER, Role.MANAGER, Role.BARISTA, Role.BAKER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.post(
    "",
    response_model=InventoryItemRead,
    status_code=201,
    summary="Create a new inventory item",
    operation_id="inventory_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_item(
    payload: InventoryItemCreate,
    user: StoreUser,
    db: DbSession,
) -> InventoryItemRead:
    item = await inv.create_item(db, store_id=user.store_id, payload=payload)
    return InventoryItemRead.model_validate(item)


@router.get(
    "",
    response_model=list[InventoryItemRead],
    summary="List inventory items in the current store",
    operation_id="inventory_list",
)
async def list_items(
    user: StoreUser,
    db: DbSession,
    search: str | None = Query(None, max_length=120),
    is_active: bool | None = Query(True),
) -> list[InventoryItemRead]:
    rows = await inv.list_items(db, store_id=user.store_id, search=search, is_active=is_active)
    return [InventoryItemRead.model_validate(r) for r in rows]


@router.get(
    "/low-stock",
    response_model=list[InventoryItemRead],
    summary="Items where stock_on_hand < par_level",
    operation_id="inventory_low_stock",
)
async def low_stock(user: StoreUser, db: DbSession) -> list[InventoryItemRead]:
    rows = await inv.low_stock(db, store_id=user.store_id)
    return [InventoryItemRead.model_validate(r) for r in rows]


@router.get(
    "/movements",
    response_model=MovementsPage,
    summary="Paginated stock movement log for the current store",
    operation_id="inventory_movements",
)
async def movements(
    user: StoreUser,
    db: DbSession,
    item_id: str | None = Query(None),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> MovementsPage:
    return await inv.list_movements(
        db, store_id=user.store_id, item_id=item_id, cursor=cursor, limit=limit
    )


@router.get(
    "/{item_id}",
    response_model=InventoryItemRead,
    summary="Get one inventory item with computed status",
    operation_id="inventory_get",
)
async def get_one(item_id: str, user: StoreUser, db: DbSession) -> InventoryItemRead:
    item = await inv.get_item(db, store_id=user.store_id, item_id=item_id)
    return InventoryItemRead.model_validate(item)


@router.patch(
    "/{item_id}",
    response_model=InventoryItemRead,
    summary="Update par_level and/or cost_per_unit (no movement created)",
    operation_id="inventory_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_one(
    item_id: str,
    payload: InventoryItemUpdate,
    user: StoreUser,
    db: DbSession,
) -> InventoryItemRead:
    item = await inv.update_item(db, store_id=user.store_id, item_id=item_id, payload=payload)
    return InventoryItemRead.model_validate(item)


@router.delete(
    "/{item_id}",
    status_code=204,
    summary="Soft-delete an inventory item (sets is_active=False)",
    operation_id="inventory_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_one(item_id: str, user: StoreUser, db: DbSession) -> None:
    await inv.delete_item(db, store_id=user.store_id, item_id=item_id)


@router.post(
    "/receive",
    response_model=InventoryItemRead,
    summary="Receive stock — increments stock_on_hand and overwrites cost_per_unit",
    operation_id="inventory_receive",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def receive(
    payload: ReceiveStockRequest,
    user: StoreUser,
    db: DbSession,
) -> InventoryItemRead:
    item = await inv.receive_stock(db, store_id=user.store_id, user_id=user.id, req=payload)
    return InventoryItemRead.model_validate(item)


@router.post(
    "/waste",
    response_model=InventoryItemRead,
    summary="Record wastage — allows negative stock; emits warning log if so",
    operation_id="inventory_waste",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def waste(
    payload: WasteRequest,
    user: StoreUser,
    db: DbSession,
) -> InventoryItemRead:
    item = await inv.record_waste(db, store_id=user.store_id, user_id=user.id, req=payload)
    return InventoryItemRead.model_validate(item)


@router.post(
    "/adjust",
    response_model=InventoryItemRead,
    summary="Audit-correction adjustment with required reason",
    operation_id="inventory_adjust",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def adjust(
    payload: AdjustRequest,
    user: StoreUser,
    db: DbSession,
) -> InventoryItemRead:
    item = await inv.adjust_stock(db, store_id=user.store_id, user_id=user.id, req=payload)
    return InventoryItemRead.model_validate(item)
