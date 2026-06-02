from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.catalog import (
    ModifierCreate,
    ModifierGroupCreate,
    ModifierGroupRead,
    ModifierGroupUpdate,
    ModifierRead,
    ModifierUpdate,
)
from app.services import catalog as svc

router = APIRouter(prefix="/modifier-groups", tags=["catalog"])

_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get(
    "",
    response_model=list[ModifierGroupRead],
    summary="List modifier groups for the current store",
    operation_id="modifier_groups_list",
)
async def list_modifier_groups(
    user: StoreUser,
    db: DbSession,
    is_active: bool | None = Query(True),
) -> list[ModifierGroupRead]:
    return await svc.list_modifier_groups(db, store_id=user.store_id, is_active=is_active)


@router.post(
    "",
    response_model=ModifierGroupRead,
    status_code=201,
    summary="Create a modifier group with optional child modifiers",
    operation_id="modifier_groups_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_modifier_group(
    payload: ModifierGroupCreate, user: StoreUser, db: DbSession
) -> ModifierGroupRead:
    return await svc.create_modifier_group(db, store_id=user.store_id, payload=payload)


@router.patch(
    "/{group_id}",
    response_model=ModifierGroupRead,
    summary="Update a modifier group; optionally bulk-replace its modifiers",
    operation_id="modifier_groups_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_modifier_group(
    group_id: str, payload: ModifierGroupUpdate, user: StoreUser, db: DbSession
) -> ModifierGroupRead:
    return await svc.update_modifier_group(
        db, store_id=user.store_id, group_id=group_id, payload=payload
    )


@router.delete(
    "/{group_id}",
    status_code=204,
    summary="Soft-delete a modifier group and its child modifiers",
    operation_id="modifier_groups_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_modifier_group(group_id: str, user: StoreUser, db: DbSession) -> None:
    await svc.delete_modifier_group(db, store_id=user.store_id, group_id=group_id)


@router.post(
    "/{group_id}/modifiers",
    response_model=ModifierRead,
    status_code=201,
    summary="Add a single modifier option to a group",
    operation_id="modifier_groups_add_modifier",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def add_modifier_to_group(
    group_id: str, payload: ModifierCreate, user: StoreUser, db: DbSession
) -> ModifierRead:
    return await svc.add_modifier(db, store_id=user.store_id, group_id=group_id, payload=payload)


@router.patch(
    "/{group_id}/modifiers/{modifier_id}",
    response_model=ModifierRead,
    summary="Update a single modifier option",
    operation_id="modifier_groups_update_modifier",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_modifier_in_group(
    group_id: str, modifier_id: str, payload: ModifierUpdate, user: StoreUser, db: DbSession
) -> ModifierRead:
    return await svc.update_modifier(
        db, store_id=user.store_id, group_id=group_id, modifier_id=modifier_id, payload=payload
    )


@router.delete(
    "/{group_id}/modifiers/{modifier_id}",
    status_code=204,
    summary="Remove a single modifier option from a group",
    operation_id="modifier_groups_delete_modifier",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_modifier_from_group(
    group_id: str, modifier_id: str, user: StoreUser, db: DbSession
) -> None:
    await svc.remove_modifier(
        db, store_id=user.store_id, group_id=group_id, modifier_id=modifier_id
    )
