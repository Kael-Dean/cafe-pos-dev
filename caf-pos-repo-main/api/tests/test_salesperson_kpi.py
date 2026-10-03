"""Full test suite for the salesperson KPI feature (Tier 8).

Covers:
  - Group A: Model / FK integrity (3 tests)
  - Group B: PATCH /customers/{id}/sales assignment endpoint (4 tests)
  - Group C: GET /salespeople list endpoint (3 tests)
  - Group D: GET /reports/salesperson-kpi report endpoint (7 tests)
"""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import OrderStatus
from app.models.orders import Order
from app.models.sales import Salesperson
from tests.factories import make_customer, make_order_direct, make_order_item

# ---------- helpers ----------


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def make_salesperson(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Test Sales",
    is_active: bool = True,
) -> Salesperson:
    sp = Salesperson(store_id=store_id, name=name, is_active=is_active)
    db.add(sp)
    await db.commit()
    await db.refresh(sp)
    return sp


# ---------- Group A: Model / FK integrity ----------


async def test_salesperson_created(db, store_a) -> None:
    sp = await make_salesperson(db, store_id=store_a.id, name="Ana Seller")
    assert sp.id is not None
    assert sp.name == "Ana Seller"
    assert sp.store_id == store_a.id
    assert sp.is_active is True


async def test_customer_sales_id_nullable(db, store_a) -> None:
    customer = await make_customer(db, store_id=store_a.id, name="No-Sales Customer")
    assert customer.sales_id is None


async def test_customer_sales_id_set_null_on_delete(db, store_a) -> None:
    sp = await make_salesperson(db, store_id=store_a.id, name="Doomed Sales")
    customer = await make_customer(db, store_id=store_a.id, name="Linked Customer")

    # Assign the salesperson directly
    customer.sales_id = sp.id
    db.add(customer)
    await db.commit()

    # Delete the salesperson — FK is SET NULL
    await db.execute(delete(Salesperson).where(Salesperson.id == sp.id))
    await db.commit()

    # Re-fetch customer and verify sales_id is cleared
    await db.refresh(customer)
    assert customer.sales_id is None


# ---------- Group B: PATCH /customers/{id}/sales ----------


async def test_assign_sales_set(client, db, store_a, user_a) -> None:
    token = await _login(client, store_a.slug, "1111")
    sp = await make_salesperson(db, store_id=store_a.id, name="Assigned Sales")
    customer = await make_customer(db, store_id=store_a.id, name="Assign Target")

    resp = await client.patch(
        f"/api/v1/customers/{customer.id}/sales",
        json={"sales_id": sp.id},
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sales_id"] == sp.id
    assert body["sales_name"] == sp.name


async def test_assign_sales_clear(client, db, store_a, user_a) -> None:
    token = await _login(client, store_a.slug, "1111")
    sp = await make_salesperson(db, store_id=store_a.id, name="Clear Sales")
    customer = await make_customer(db, store_id=store_a.id, name="Clear Target")

    # First assign
    await client.patch(
        f"/api/v1/customers/{customer.id}/sales",
        json={"sales_id": sp.id},
        headers=_headers(token),
    )

    # Then clear
    resp = await client.patch(
        f"/api/v1/customers/{customer.id}/sales",
        json={"sales_id": None},
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["sales_id"] is None


async def test_assign_sales_404_cross_store(client, db, store_a, store_b, user_a, user_b) -> None:
    token = await _login(client, store_a.slug, "1111")
    sp_b = await make_salesperson(db, store_id=store_b.id, name="Store-B Sales")
    customer_a = await make_customer(db, store_id=store_a.id, name="Store-A Customer")

    # Authenticated as user_a on store_a; sp_b belongs to store_b → 404
    resp = await client.patch(
        f"/api/v1/customers/{customer_a.id}/sales",
        json={"sales_id": sp_b.id},
        headers=_headers(token),
    )
    assert resp.status_code == 404, resp.text


async def test_assign_sales_404_unknown(client, db, store_a, user_a) -> None:
    token = await _login(client, store_a.slug, "1111")
    customer = await make_customer(db, store_id=store_a.id, name="Unknown Sales Target")

    resp = await client.patch(
        f"/api/v1/customers/{customer.id}/sales",
        json={"sales_id": "nonexistent_id_00000000"},
        headers=_headers(token),
    )
    assert resp.status_code == 404, resp.text


# ---------- Group C: GET /salespeople ----------


async def test_list_salespeople(client, db, store_a, user_a) -> None:
    token = await _login(client, store_a.slug, "1111")
    sp = await make_salesperson(db, store_id=store_a.id, name="Active Salesperson")

    resp = await client.get("/api/v1/salespeople", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    ids = [s["id"] for s in resp.json()]
    assert sp.id in ids


async def test_list_salespeople_excludes_inactive(client, db, store_a, user_a) -> None:
    token = await _login(client, store_a.slug, "1111")
    active = await make_salesperson(db, store_id=store_a.id, name="Active One")
    inactive = await make_salesperson(db, store_id=store_a.id, name="Inactive One", is_active=False)

    resp = await client.get("/api/v1/salespeople", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    ids = [s["id"] for s in resp.json()]
    assert active.id in ids
    assert inactive.id not in ids


async def test_list_salespeople_store_isolation(client, db, store_a, store_b, user_a) -> None:
    token = await _login(client, store_a.slug, "1111")
    sp_a = await make_salesperson(db, store_id=store_a.id, name="Store-A Seller")
    sp_b = await make_salesperson(db, store_id=store_b.id, name="Store-B Seller")

    # Authenticated on store_a — store_b salesperson must not appear
    resp = await client.get("/api/v1/salespeople", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    ids = [s["id"] for s in resp.json()]
    assert sp_a.id in ids
    assert sp_b.id not in ids


# ---------- Group D: GET /reports/salesperson-kpi ----------


def _wide_range() -> tuple[str, str]:
    """ISO datetime strings spanning the current year."""
    year = datetime.now(UTC).year
    return f"{year}-01-01T00:00:00+00:00", f"{year}-12-31T23:59:59+00:00"


async def _manager_headers(client, store_a) -> dict[str, str]:
    token = await _login(client, store_a.slug, "2222")
    return _headers(token)


async def test_kpi_report_multi_order_aggregation(client, db, store_a, manager_a, user_a) -> None:
    sp = await make_salesperson(db, store_id=store_a.id, name="Multi-Order Sales")
    customer = await make_customer(db, store_id=store_a.id, name="Loyal Buyer")
    customer.sales_id = sp.id
    db.add(customer)
    await db.commit()

    order1 = await make_order_direct(
        db,
        store_id=store_a.id,
        created_by_id=user_a.id,
        total=Decimal("100.00"),
        status=OrderStatus.PAID,
        customer_id=customer.id,
    )
    await make_order_item(
        db, order_id=order1.id, product_name="Latte", quantity=2, unit_price=Decimal("50.00")
    )

    order2 = await make_order_direct(
        db,
        store_id=store_a.id,
        created_by_id=user_a.id,
        total=Decimal("80.00"),
        status=OrderStatus.COMPLETED,
        customer_id=customer.id,
    )
    await make_order_item(
        db, order_id=order2.id, product_name="Croissant", quantity=1, unit_price=Decimal("80.00")
    )

    hdrs = await _manager_headers(client, store_a)
    from_, to = _wide_range()
    resp = await client.get("/api/v1/reports/salesperson-kpi", params={"from": from_, "to": to}, headers=hdrs)
    assert resp.status_code == 200, resp.text

    sp_rows = resp.json()["salespeople"]
    sp_row = next(s for s in sp_rows if s["sales_id"] == sp.id)
    member = next(m for m in sp_row["members"] if m["customer_id"] == customer.id)

    assert member["order_count"] == 2
    assert member["total_items"] == 3
    assert Decimal(str(member["total_value"])) == Decimal("180.00")


async def test_kpi_void_excluded(client, db, store_a, manager_a, user_a) -> None:
    sp = await make_salesperson(db, store_id=store_a.id, name="Void Sales")
    customer = await make_customer(db, store_id=store_a.id, name="Voider")
    customer.sales_id = sp.id
    db.add(customer)
    await db.commit()

    void_order = await make_order_direct(
        db,
        store_id=store_a.id,
        created_by_id=user_a.id,
        total=Decimal("90.00"),
        status=OrderStatus.VOID,
        customer_id=customer.id,
    )
    await make_order_item(
        db, order_id=void_order.id, product_name="Espresso", quantity=1, unit_price=Decimal("90.00")
    )

    hdrs = await _manager_headers(client, store_a)
    from_, to = _wide_range()
    resp = await client.get("/api/v1/reports/salesperson-kpi", params={"from": from_, "to": to}, headers=hdrs)
    assert resp.status_code == 200, resp.text

    sp_rows = resp.json()["salespeople"]
    sp_row = next(s for s in sp_rows if s["sales_id"] == sp.id)
    assert sp_row["buying_member_count"] == 0
    assert sp_row["member_count"] == 1
    assert len(sp_row["members"]) == 1
    assert sp_row["total_items"] == 0
    assert Decimal(str(sp_row["total_value"])) == Decimal("0.00")

    member = next(m for m in sp_row["members"] if m["customer_id"] == customer.id)
    assert member["order_count"] == 0


async def test_kpi_zero_buyer_member_included(client, db, store_a, manager_a, user_a) -> None:
    sp = await make_salesperson(db, store_id=store_a.id, name="Zero Buyer Sales")
    customer = await make_customer(db, store_id=store_a.id, name="Silent Member")
    customer.sales_id = sp.id
    db.add(customer)
    await db.commit()

    # No orders at all for this customer
    hdrs = await _manager_headers(client, store_a)
    from_, to = _wide_range()
    resp = await client.get("/api/v1/reports/salesperson-kpi", params={"from": from_, "to": to}, headers=hdrs)
    assert resp.status_code == 200, resp.text

    # Pin wire-format top-level keys
    assert "from_" in resp.json()
    assert "to" in resp.json()

    sp_rows = resp.json()["salespeople"]
    sp_row = next(s for s in sp_rows if s["sales_id"] == sp.id)

    # Member appears in the list
    member_ids = [m["customer_id"] for m in sp_row["members"]]
    assert customer.id in member_ids

    # But buying_member_count does not include them
    assert sp_row["buying_member_count"] == 0

    member = next(m for m in sp_row["members"] if m["customer_id"] == customer.id)
    assert member["order_count"] == 0
    assert member["total_items"] == 0


async def test_kpi_buying_member_count(client, db, store_a, manager_a, user_a) -> None:
    sp = await make_salesperson(db, store_id=store_a.id, name="Buying Count Sales")

    buyer = await make_customer(db, store_id=store_a.id, name="Buyer")
    buyer.sales_id = sp.id

    non_buyer = await make_customer(db, store_id=store_a.id, name="Non Buyer", phone="0899999991")
    non_buyer.sales_id = sp.id

    db.add(buyer)
    db.add(non_buyer)
    await db.commit()

    order = await make_order_direct(
        db,
        store_id=store_a.id,
        created_by_id=user_a.id,
        total=Decimal("50.00"),
        status=OrderStatus.PAID,
        customer_id=buyer.id,
    )
    await make_order_item(db, order_id=order.id, product_name="Tea", quantity=1, unit_price=Decimal("50.00"))

    hdrs = await _manager_headers(client, store_a)
    from_, to = _wide_range()
    resp = await client.get("/api/v1/reports/salesperson-kpi", params={"from": from_, "to": to}, headers=hdrs)
    assert resp.status_code == 200, resp.text

    sp_rows = resp.json()["salespeople"]
    sp_row = next(s for s in sp_rows if s["sales_id"] == sp.id)

    assert sp_row["member_count"] == 2
    assert sp_row["buying_member_count"] == 1
    assert sp_row["buying_member_count"] <= sp_row["member_count"]


async def test_kpi_inclusive_date_boundary(client, db, store_a, manager_a, user_a) -> None:
    sp = await make_salesperson(db, store_id=store_a.id, name="Boundary Sales")
    customer = await make_customer(db, store_id=store_a.id, name="Boundary Buyer")
    customer.sales_id = sp.id
    db.add(customer)
    await db.commit()

    boundary_ts = datetime(2026, 6, 15, 12, 0, 0, tzinfo=UTC)
    order = await make_order_direct(
        db,
        store_id=store_a.id,
        created_by_id=user_a.id,
        total=Decimal("60.00"),
        status=OrderStatus.PAID,
        customer_id=customer.id,
    )
    # Force created_at to the exact boundary timestamp
    await db.execute(update(Order).where(Order.id == order.id).values(created_at=boundary_ts))
    await db.commit()

    await make_order_item(
        db, order_id=order.id, product_name="Boundary Item", quantity=1, unit_price=Decimal("60.00")
    )

    # Query with `to` equal to the boundary — should include the order.
    # Use timezone-aware strings so Postgres compares correctly with timestamptz.
    hdrs = await _manager_headers(client, store_a)
    resp = await client.get(
        "/api/v1/reports/salesperson-kpi",
        params={"from": "2026-06-01T00:00:00+00:00", "to": "2026-06-15T12:00:00+00:00"},
        headers=hdrs,
    )
    assert resp.status_code == 200, resp.text

    sp_rows = resp.json()["salespeople"]
    sp_row = next((s for s in sp_rows if s["sales_id"] == sp.id), None)
    assert sp_row is not None
    member = next(m for m in sp_row["members"] if m["customer_id"] == customer.id)
    assert member["order_count"] == 1


async def test_kpi_store_isolation(client, db, store_a, store_b, manager_a, user_a, user_b) -> None:
    await make_salesperson(db, store_id=store_a.id, name="Isolated Sales A")
    sp_b = await make_salesperson(db, store_id=store_b.id, name="Isolated Sales B")

    customer_b = await make_customer(db, store_id=store_b.id, name="Store-B Buyer")
    customer_b.sales_id = sp_b.id
    db.add(customer_b)
    await db.commit()

    order = await make_order_direct(
        db,
        store_id=store_b.id,
        created_by_id=user_b.id,
        total=Decimal("75.00"),
        status=OrderStatus.PAID,
        customer_id=customer_b.id,
    )
    await make_order_item(
        db, order_id=order.id, product_name="Matcha", quantity=1, unit_price=Decimal("75.00")
    )

    hdrs = await _manager_headers(client, store_a)
    from_, to = _wide_range()
    resp = await client.get("/api/v1/reports/salesperson-kpi", params={"from": from_, "to": to}, headers=hdrs)
    assert resp.status_code == 200, resp.text

    sp_ids = [s["sales_id"] for s in resp.json()["salespeople"]]
    # store_a report must not contain store_b salesperson
    assert sp_b.id not in sp_ids


async def test_kpi_unassigned_customer_excluded(client, db, store_a, manager_a, user_a) -> None:
    sp = await make_salesperson(db, store_id=store_a.id, name="Exclusive Sales")
    assigned = await make_customer(db, store_id=store_a.id, name="Assigned Member")
    assigned.sales_id = sp.id
    db.add(assigned)

    unassigned = await make_customer(db, store_id=store_a.id, name="No-Sales Member", phone="0877770001")
    # unassigned.sales_id remains None

    await db.commit()

    order = await make_order_direct(
        db,
        store_id=store_a.id,
        created_by_id=user_a.id,
        total=Decimal("40.00"),
        status=OrderStatus.PAID,
        customer_id=unassigned.id,
    )
    await make_order_item(
        db, order_id=order.id, product_name="Water", quantity=1, unit_price=Decimal("40.00")
    )

    hdrs = await _manager_headers(client, store_a)
    from_, to = _wide_range()
    resp = await client.get("/api/v1/reports/salesperson-kpi", params={"from": from_, "to": to}, headers=hdrs)
    assert resp.status_code == 200, resp.text

    sp_rows = resp.json()["salespeople"]
    sp_row = next(s for s in sp_rows if s["sales_id"] == sp.id)

    # Only the assigned customer should be in members list
    member_ids = [m["customer_id"] for m in sp_row["members"]]
    assert assigned.id in member_ids
    assert unassigned.id not in member_ids
