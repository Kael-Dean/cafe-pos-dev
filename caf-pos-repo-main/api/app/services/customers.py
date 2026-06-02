import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.models import Customer
from app.models.orders import Order
from app.schemas.customers import (
    CreateCustomerRequest,
    CustomerRead,
    CustomersPage,
    OrderSummary,
    UpdateCustomerRequest,
)

logger = logging.getLogger(__name__)

_DEFAULT_PAGE = 50
_MAX_PAGE = 200
_RECENT_ORDERS_LIMIT = 10


async def list_customers(
    db: AsyncSession,
    *,
    store_id: str,
    name: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    page: int = 1,
    limit: int = _DEFAULT_PAGE,
) -> CustomersPage:
    limit = min(limit, _MAX_PAGE)
    stmt = (
        select(Customer)
        .where(Customer.store_id == store_id, Customer.is_active.is_(True))
        .order_by(Customer.name)
    )
    if name:
        stmt = stmt.where(Customer.name.ilike(f"%{name}%"))
    if phone:
        stmt = stmt.where(Customer.phone.ilike(f"%{phone}%"))
    if email:
        stmt = stmt.where(Customer.email.ilike(f"%{email}%"))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    offset = (page - 1) * limit
    rows = list((await db.execute(stmt.offset(offset).limit(limit))).scalars())

    items = [CustomerRead.model_validate({**c.__dict__, "recent_orders": []}) for c in rows]
    return CustomersPage(items=items, total=total, page=page, limit=limit)


async def get_customer(db: AsyncSession, *, store_id: str, customer_id: str) -> CustomerRead:
    customer = await _load_customer(db, store_id=store_id, customer_id=customer_id)

    orders_stmt = (
        select(Order)
        .where(Order.store_id == store_id, Order.customer_id == customer_id)
        .order_by(Order.created_at.desc())
        .limit(_RECENT_ORDERS_LIMIT)
    )
    recent_rows = list((await db.execute(orders_stmt)).scalars())
    recent_orders = [OrderSummary.model_validate(o) for o in recent_rows]

    return CustomerRead.model_validate({**customer.__dict__, "recent_orders": recent_orders})


async def create_customer(
    db: AsyncSession,
    *,
    store_id: str,
    req: CreateCustomerRequest,
) -> CustomerRead:
    async with db.begin():
        await _check_unique_phone(db, store_id=store_id, phone=req.phone, exclude_id=None)
        await _check_unique_email(db, store_id=store_id, email=req.email, exclude_id=None)
        customer = Customer(
            store_id=store_id,
            name=req.name,
            phone=req.phone,
            email=req.email,
            notes=req.notes,
        )
        db.add(customer)

    await db.refresh(customer)
    return CustomerRead.model_validate({**customer.__dict__, "recent_orders": []})


async def update_customer(
    db: AsyncSession,
    *,
    store_id: str,
    customer_id: str,
    req: UpdateCustomerRequest,
) -> CustomerRead:
    async with db.begin():
        if req.phone is not None:
            await _check_unique_phone(db, store_id=store_id, phone=req.phone, exclude_id=customer_id)
        if req.email is not None:
            await _check_unique_email(db, store_id=store_id, email=req.email, exclude_id=customer_id)
        customer = await _load_customer(db, store_id=store_id, customer_id=customer_id)
        if req.name is not None:
            customer.name = req.name
        if req.phone is not None:
            customer.phone = req.phone
        if req.email is not None:
            customer.email = req.email
        if req.notes is not None:
            customer.notes = req.notes

    await db.refresh(customer)
    return CustomerRead.model_validate({**customer.__dict__, "recent_orders": []})


async def delete_customer(db: AsyncSession, *, store_id: str, customer_id: str) -> None:
    async with db.begin():
        customer = await _load_customer(db, store_id=store_id, customer_id=customer_id)
        customer.is_active = False


async def _load_customer(db: AsyncSession, *, store_id: str, customer_id: str) -> Customer:
    result = await db.execute(
        select(Customer).where(
            Customer.id == customer_id,
            Customer.store_id == store_id,
            Customer.is_active.is_(True),
        )
    )
    customer = result.scalar_one_or_none()
    if not customer:
        raise NotFound("Customer not found")
    return customer


async def _check_unique_phone(
    db: AsyncSession, *, store_id: str, phone: str | None, exclude_id: str | None
) -> None:
    if not phone:
        return
    stmt = select(Customer).where(
        Customer.store_id == store_id,
        Customer.phone == phone,
        Customer.is_active.is_(True),
    )
    if exclude_id:
        stmt = stmt.where(Customer.id != exclude_id)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        raise Conflict("A customer with this phone number already exists")


async def _check_unique_email(
    db: AsyncSession, *, store_id: str, email: str | None, exclude_id: str | None
) -> None:
    if not email:
        return
    stmt = select(Customer).where(
        Customer.store_id == store_id,
        Customer.email == email,
        Customer.is_active.is_(True),
    )
    if exclude_id:
        stmt = stmt.where(Customer.id != exclude_id)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        raise Conflict("A customer with this email already exists")
