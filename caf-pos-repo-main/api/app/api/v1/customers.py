from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.customers import CreateCustomerRequest, CustomerRead, CustomersPage, UpdateCustomerRequest
from app.schemas.salespeople import AssignSalesRequest
from app.services import customers as svc

router = APIRouter(prefix="/customers", tags=["customers"])

_BARISTA_PLUS = require_role(Role.OWNER, Role.MANAGER, Role.BARISTA, Role.BAKER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get(
    "", response_model=CustomersPage, summary="List and search customers", operation_id="customers_list"
)
async def list_customers(
    user: StoreUser,
    db: DbSession,
    name: str | None = Query(default=None),
    phone: str | None = Query(default=None),
    email: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
) -> CustomersPage:
    return await svc.list_customers(
        db,
        store_id=user.store_id,
        name=name,
        phone=phone,
        email=email,
        page=page,
        limit=limit,
    )


@router.get(
    "/{customer_id}",
    response_model=CustomerRead,
    summary="Customer detail with recent orders",
    operation_id="customers_get",
)
async def get_customer(
    customer_id: str,
    user: StoreUser,
    db: DbSession,
) -> CustomerRead:
    return await svc.get_customer(db, store_id=user.store_id, customer_id=customer_id)


@router.post(
    "",
    response_model=CustomerRead,
    status_code=201,
    summary="Create a new customer",
    operation_id="customers_create",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def create_customer(
    req: CreateCustomerRequest,
    user: StoreUser,
    db: DbSession,
) -> CustomerRead:
    return await svc.create_customer(db, store_id=user.store_id, req=req)


@router.patch(
    "/{customer_id}",
    response_model=CustomerRead,
    summary="Update customer name, phone, or email",
    operation_id="customers_update",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def update_customer(
    customer_id: str,
    req: UpdateCustomerRequest,
    user: StoreUser,
    db: DbSession,
) -> CustomerRead:
    return await svc.update_customer(db, store_id=user.store_id, customer_id=customer_id, req=req)


@router.patch(
    "/{customer_id}/sales",
    response_model=CustomerRead,
    summary="Assign or clear a customer's salesperson",
    operation_id="customers_assign_sales",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def assign_sales(
    customer_id: str,
    req: AssignSalesRequest,
    user: StoreUser,
    db: DbSession,
) -> CustomerRead:
    return await svc.assign_sales(db, store_id=user.store_id, customer_id=customer_id, sales_id=req.sales_id)


@router.delete(
    "/{customer_id}",
    status_code=204,
    summary="Soft-delete a customer",
    operation_id="customers_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_customer(
    customer_id: str,
    user: StoreUser,
    db: DbSession,
) -> None:
    await svc.delete_customer(db, store_id=user.store_id, customer_id=customer_id)
