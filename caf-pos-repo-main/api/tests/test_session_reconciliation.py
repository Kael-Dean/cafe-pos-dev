from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Unprocessable
from app.enums import PaymentMethod
from app.models.hr import CashSession
from app.schemas.hr import (
    CashSessionClosePayload,
    PaymentGroupConfig,
    ReconciliationEntryCreate,
)
from app.services import hr as svc
from tests.factories import make_order_direct


async def _make_session(db: AsyncSession, store_id: str, user_id: str) -> CashSession:
    async with db.begin():
        session = CashSession(
            store_id=store_id,
            opened_by_id=user_id,
            cash_open=Decimal("500.00"),
            opened_at=datetime.now(UTC) - timedelta(hours=1),
        )
        db.add(session)
    await db.refresh(session)
    await db.commit()  # close autobegin triggered by refresh
    return session


# ---------------------------------------------------------------------------
# get_payment_groups
# ---------------------------------------------------------------------------


async def test_get_payment_groups_returns_default_when_not_set(db, store_a):
    groups = await svc.get_payment_groups(db, store_id=store_a.id)
    names = [g["name"] for g in groups]
    assert "Cash" in names
    assert "Online" in names
    assert len(groups) == 2


# ---------------------------------------------------------------------------
# set_payment_groups
# ---------------------------------------------------------------------------


async def test_set_payment_groups_saves_custom_config(db, store_a):
    payload = [
        PaymentGroupConfig(name="Cash", methods=[PaymentMethod.CASH]),
        PaymentGroupConfig(name="Card", methods=[PaymentMethod.CARD]),
        PaymentGroupConfig(
            name="QR",
            methods=[PaymentMethod.QR_PROMPTPAY, PaymentMethod.LINE_PAY, PaymentMethod.TRUEMONEY],
        ),
        PaymentGroupConfig(name="Other", methods=[PaymentMethod.OTHER]),
    ]
    result = await svc.set_payment_groups(db, store_id=store_a.id, groups=payload)
    assert len(result) == 4
    assert result[1]["name"] == "Card"


async def test_set_payment_groups_rejects_missing_method(db, store_a):
    payload = [
        PaymentGroupConfig(name="Cash", methods=[PaymentMethod.CASH]),
        PaymentGroupConfig(
            name="Online",
            methods=[PaymentMethod.CARD, PaymentMethod.QR_PROMPTPAY, PaymentMethod.LINE_PAY, PaymentMethod.TRUEMONEY],
        ),
        # OTHER is missing
    ]
    with pytest.raises(Unprocessable):
        await svc.set_payment_groups(db, store_id=store_a.id, groups=payload)


async def test_set_payment_groups_rejects_duplicate_method(db, store_a):
    payload = [
        PaymentGroupConfig(name="Cash", methods=[PaymentMethod.CASH]),
        PaymentGroupConfig(
            name="Online",
            methods=[PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.QR_PROMPTPAY, PaymentMethod.LINE_PAY, PaymentMethod.TRUEMONEY, PaymentMethod.OTHER],
        ),
    ]
    with pytest.raises(Unprocessable):
        await svc.set_payment_groups(db, store_id=store_a.id, groups=payload)


# ---------------------------------------------------------------------------
# get_session_summary
# ---------------------------------------------------------------------------


async def test_get_session_summary_buckets_orders_by_group(db, store_a, user_a):
    session = await _make_session(db, store_a.id, user_a.id)
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("100.00"), payment_method=PaymentMethod.CASH,
    )
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("200.00"), payment_method=PaymentMethod.CARD,
    )
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("150.00"), payment_method=PaymentMethod.QR_PROMPTPAY,
    )

    summary = await svc.get_session_summary(db, store_id=store_a.id, session_id=session.id)

    assert summary.session_id == session.id
    cash_group = next(g for g in summary.groups if g.name == "Cash")
    online_group = next(g for g in summary.groups if g.name == "Online")
    assert cash_group.system_total == Decimal("100.00")
    assert online_group.system_total == Decimal("350.00")


async def test_get_session_summary_returns_zero_for_empty_group(db, store_a, user_a):
    session = await _make_session(db, store_a.id, user_a.id)
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("500.00"), payment_method=PaymentMethod.CASH,
    )

    summary = await svc.get_session_summary(db, store_id=store_a.id, session_id=session.id)

    online_group = next(g for g in summary.groups if g.name == "Online")
    assert online_group.system_total == Decimal("0")


# ---------------------------------------------------------------------------
# close_cash_session (reconciliation)
# ---------------------------------------------------------------------------


async def test_close_session_persists_entries_and_variance(db, store_a, user_a, manager_a):
    session = await _make_session(db, store_a.id, user_a.id)
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("400.00"), payment_method=PaymentMethod.CASH,
    )
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("600.00"), payment_method=PaymentMethod.CARD,
    )

    payload = CashSessionClosePayload(entries=[
        ReconciliationEntryCreate(group_name="Cash", actual_amount=Decimal("380.00"), notes="Short 20"),
        ReconciliationEntryCreate(group_name="Online", actual_amount=Decimal("600.00"), notes=None),
    ])
    result = await svc.close_cash_session(
        db, store_id=store_a.id, session_id=session.id,
        closed_by_id=manager_a.id, payload=payload,
    )

    assert result.closed_at is not None
    cash_entry = next(e for e in result.entries if e.group_name == "Cash")
    assert cash_entry.system_total == Decimal("400.00")
    assert cash_entry.actual_amount == Decimal("380.00")
    assert cash_entry.variance == Decimal("-20.00")
    assert cash_entry.notes == "Short 20"

    online_entry = next(e for e in result.entries if e.group_name == "Online")
    assert online_entry.system_total == Decimal("600.00")
    assert online_entry.variance == Decimal("0.00")


async def test_close_session_raises_409_if_already_closed(db, store_a, user_a, manager_a):
    from app.core.errors import Conflict

    session = await _make_session(db, store_a.id, user_a.id)
    payload = CashSessionClosePayload(entries=[
        ReconciliationEntryCreate(group_name="Cash", actual_amount=Decimal("0.00")),
        ReconciliationEntryCreate(group_name="Online", actual_amount=Decimal("0.00")),
    ])
    await svc.close_cash_session(
        db, store_id=store_a.id, session_id=session.id,
        closed_by_id=manager_a.id, payload=payload,
    )
    with pytest.raises(Conflict):
        await svc.close_cash_session(
            db, store_id=store_a.id, session_id=session.id,
            closed_by_id=manager_a.id, payload=payload,
        )


async def test_close_session_raises_422_for_unknown_group(db, store_a, user_a, manager_a):
    session = await _make_session(db, store_a.id, user_a.id)
    payload = CashSessionClosePayload(entries=[
        ReconciliationEntryCreate(group_name="Cash", actual_amount=Decimal("0.00")),
        ReconciliationEntryCreate(group_name="Nonexistent", actual_amount=Decimal("0.00")),
    ])
    with pytest.raises(Unprocessable):
        await svc.close_cash_session(
            db, store_id=store_a.id, session_id=session.id,
            closed_by_id=manager_a.id, payload=payload,
        )


async def test_close_session_raises_422_for_missing_group(db, store_a, user_a, manager_a):
    session = await _make_session(db, store_a.id, user_a.id)
    payload = CashSessionClosePayload(entries=[
        ReconciliationEntryCreate(group_name="Cash", actual_amount=Decimal("0.00")),
        # "Online" group missing
    ])
    with pytest.raises(Unprocessable):
        await svc.close_cash_session(
            db, store_id=store_a.id, session_id=session.id,
            closed_by_id=manager_a.id, payload=payload,
        )


# ---------------------------------------------------------------------------
# HTTP tests
# ---------------------------------------------------------------------------


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_get_payment_groups_returns_200(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.get("/api/v1/hr/payment-groups", headers=_headers(token))
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert any(g["name"] == "Cash" for g in data)


async def test_patch_payment_groups_requires_manager(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.patch(
        "/api/v1/hr/payment-groups",
        headers=_headers(token),
        json=[
            {"name": "Cash", "methods": ["CASH"]},
            {"name": "Online", "methods": ["CARD", "QR_PROMPTPAY", "LINE_PAY", "TRUEMONEY", "OTHER"]},
        ],
    )
    assert resp.status_code == 403


async def test_get_session_summary_returns_groups(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    open_resp = await client.post(
        "/api/v1/hr/cash-sessions", headers=_headers(token), json={"cash_open": "500.00"}
    )
    assert open_resp.status_code == 201
    session_id = open_resp.json()["id"]

    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("100.00"), payment_method=PaymentMethod.CASH,
    )

    resp = await client.get(
        f"/api/v1/hr/cash-sessions/{session_id}/summary", headers=_headers(token)
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "groups" in data
    cash_group = next(g for g in data["groups"] if g["name"] == "Cash")
    assert Decimal(cash_group["system_total"]) == Decimal("100.00")


async def test_close_session_with_entries_closes_session(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    open_resp = await client.post(
        "/api/v1/hr/cash-sessions", headers=_headers(token), json={"cash_open": "500.00"}
    )
    assert open_resp.status_code == 201
    session_id = open_resp.json()["id"]

    resp = await client.patch(
        f"/api/v1/hr/cash-sessions/{session_id}/close",
        headers=_headers(token),
        json={
            "entries": [
                {"group_name": "Cash", "actual_amount": "0.00", "notes": None},
                {"group_name": "Online", "actual_amount": "0.00", "notes": None},
            ]
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["closed_at"] is not None
    assert len(data["entries"]) == 2
