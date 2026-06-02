from fastapi import APIRouter
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, PlainTextResponse

from app.deps import DbSession, StoreUser
from app.schemas.pre_orders import ShoppingListItemCreate, ShoppingListItemRead
from app.services import shopping_list as svc

router = APIRouter(prefix="/shopping-list", tags=["shopping-list"])


@router.get("", response_model=list[ShoppingListItemRead],
            summary="List shopping list items", operation_id="shopping_list_list")
async def list_shopping_list(user: StoreUser, db: DbSession) -> list[ShoppingListItemRead]:
    return await svc.list_shopping_list(db, store_id=user.store_id)


@router.get("/print", response_class=PlainTextResponse,
            summary="Printable shopping list as plain text", operation_id="shopping_list_print")
async def print_shopping_list(user: StoreUser, db: DbSession) -> PlainTextResponse:
    return await svc.print_shopping_list(db, store_id=user.store_id)


@router.post("", response_model=ShoppingListItemRead,
             summary="Add ingredient to shopping list (idempotent)", operation_id="shopping_list_add")
async def add_to_shopping_list(
    payload: ShoppingListItemCreate, user: StoreUser, db: DbSession
):
    item, created = await svc.add_to_shopping_list(
        db, store_id=user.store_id, user_id=user.id, payload=payload
    )
    status_code = 201 if created else 200
    return JSONResponse(content=jsonable_encoder(item), status_code=status_code)


@router.delete("/{item_id}", status_code=204,
               summary="Remove item from shopping list", operation_id="shopping_list_remove")
async def remove_from_shopping_list(item_id: str, user: StoreUser, db: DbSession) -> None:
    await svc.remove_from_shopping_list(db, store_id=user.store_id, item_id=item_id)
