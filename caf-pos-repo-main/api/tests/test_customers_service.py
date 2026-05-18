"""Service-layer tests for the customers module (Tier 7).

Runs against real Postgres. Uses the shared conftest fixtures for db session,
stores, and users.
"""
import secrets

import pytest
import pytest_asyncio

from app.core.errors import Conflict, NotFound
from app.schemas.customers import CreateCustomerRequest, UpdateCustomerRequest
from app.services import customers as svc
from tests.factories import make_customer


def _phone() -> str:
    return f"08{secrets.randbelow(10 ** 8):08d}"


def _email() -> str:
    return f"test_{secrets.token_hex(4)}@example.com"


# ---------- fixtures ----------


@pytest_asyncio.fixture(loop_scope="session")
async def customer_a(db, store_a):
    return await make_customer(
        db,
        store_id=store_a.id,
        name="Alice Latte",
        phone=_phone(),
        email=_email(),
    )


# ---------- tests ----------


@pytest.mark.asyncio
async def test_list_customers_returns_store_customers(db, store_a, customer_a):
    page = await svc.list_customers(db, store_id=store_a.id)
    ids = [c.id for c in page.items]
    assert customer_a.id in ids


@pytest.mark.asyncio
async def test_list_customers_phone_filter(db, store_a):
    phone = _phone()
    customer = await make_customer(db, store_id=store_a.id, name="PhoneFilter", phone=phone)
    page = await svc.list_customers(db, store_id=store_a.id, phone=phone[:6])
    assert any(c.id == customer.id for c in page.items)


@pytest.mark.asyncio
async def test_list_customers_name_filter(db, store_a):
    unique = secrets.token_hex(6)
    customer = await make_customer(db, store_id=store_a.id, name=f"UniqueFilter-{unique}")
    page = await svc.list_customers(db, store_id=store_a.id, name=unique)
    assert len(page.items) == 1
    assert page.items[0].id == customer.id


@pytest.mark.asyncio
async def test_get_customer_returns_detail(db, store_a, customer_a):
    detail = await svc.get_customer(db, store_id=store_a.id, customer_id=customer_a.id)
    assert detail.id == customer_a.id
    assert detail.name == customer_a.name
    assert isinstance(detail.recent_orders, list)


@pytest.mark.asyncio
async def test_get_customer_wrong_store_raises(db, store_b, customer_a):
    with pytest.raises(NotFound):
        await svc.get_customer(db, store_id=store_b.id, customer_id=customer_a.id)


@pytest.mark.asyncio
async def test_create_customer_ok(db, store_a):
    req = CreateCustomerRequest(name="New Customer", phone=_phone(), email=_email())
    result = await svc.create_customer(db, store_id=store_a.id, req=req)
    assert result.name == req.name
    assert result.id is not None


@pytest.mark.asyncio
async def test_create_customer_duplicate_phone_raises(db, store_a):
    phone = _phone()
    await make_customer(db, store_id=store_a.id, name="First", phone=phone)
    req = CreateCustomerRequest(name="Second", phone=phone)
    with pytest.raises(Conflict):
        await svc.create_customer(db, store_id=store_a.id, req=req)


@pytest.mark.asyncio
async def test_create_customer_duplicate_email_raises(db, store_a):
    email = _email()
    await make_customer(db, store_id=store_a.id, name="First", email=email)
    req = CreateCustomerRequest(name="Second", email=email)
    with pytest.raises(Conflict):
        await svc.create_customer(db, store_id=store_a.id, req=req)


@pytest.mark.asyncio
async def test_update_customer_name(db, store_a, customer_a):
    req = UpdateCustomerRequest(name="Updated Name")
    result = await svc.update_customer(
        db, store_id=store_a.id, customer_id=customer_a.id, req=req
    )
    assert result.name == "Updated Name"


@pytest.mark.asyncio
async def test_update_customer_wrong_store_raises(db, store_b, customer_a):
    req = UpdateCustomerRequest(name="Hacked")
    with pytest.raises(NotFound):
        await svc.update_customer(
            db, store_id=store_b.id, customer_id=customer_a.id, req=req
        )


@pytest.mark.asyncio
async def test_delete_customer_soft_deletes(db, store_a):
    customer = await make_customer(db, store_id=store_a.id, name="ToDelete")
    await svc.delete_customer(db, store_id=store_a.id, customer_id=customer.id)

    with pytest.raises(NotFound):
        await svc.get_customer(db, store_id=store_a.id, customer_id=customer.id)
