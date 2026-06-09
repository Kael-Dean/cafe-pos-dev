"""Tests for the membership module."""
import pytest
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict
from app.enums import EarnMode, MembershipTier, PointTxType, RewardScope, RewardType
from app.models.customers import Customer
from app.models.membership import MembershipAccount, MembershipProgram, PointTransaction
from app.services import membership as svc
from app.schemas.membership import (
    AdjustPointsRequest, LookupRequest, RegisterMemberRequest,
    SetRewardProductsRequest, UpsertProgramRequest,
)
from tests.factories import make_category, make_product, make_user


# ── helpers ──────────────────────────────────────────────────────────────────


async def make_program(db: AsyncSession, *, store_id: str, **kwargs) -> MembershipProgram:
    defaults = dict(
        earn_mode=EarnMode.PER_RECEIPT,
        points_to_redeem=10,
        reward_type=RewardType.DISCOUNT_FIXED,
        reward_value=Decimal("50.00"),
        reward_scope=RewardScope.ALL,
    )
    defaults.update(kwargs)
    program = MembershipProgram(store_id=store_id, **defaults)
    db.add(program)
    await db.commit()
    return program


async def make_member(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Malee",
    phone: str = "0811111111",
    points_balance: int = 0,
    lifetime_points_earned: int = 0,
    **kwargs,
) -> tuple[Customer, MembershipAccount]:
    customer = Customer(store_id=store_id, name=name, phone=phone)
    db.add(customer)
    await db.flush()
    account = MembershipAccount(
        customer_id=customer.id,
        store_id=store_id,
        points_balance=points_balance,
        lifetime_points_earned=lifetime_points_earned,
        **kwargs,
    )
    db.add(account)
    await db.commit()
    return customer, account


# ── program config ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_program_returns_none_when_not_configured(db: AsyncSession, store_a):
    result = await svc.get_program(db, store_id=store_a.id)
    assert result is None


@pytest.mark.asyncio
async def test_upsert_program_creates_new(db: AsyncSession, store_a):
    req = UpsertProgramRequest(
        earn_mode=EarnMode.PER_BAHT,
        baht_per_point=Decimal("50"),
        points_to_redeem=100,
        reward_type=RewardType.DISCOUNT_FIXED,
        reward_value=Decimal("80"),
        reward_scope=RewardScope.ALL,
    )
    result = await svc.upsert_program(db, store_id=store_a.id, req=req)
    assert result.earn_mode == EarnMode.PER_BAHT
    assert result.baht_per_point == Decimal("50")
    assert result.points_to_redeem == 100


@pytest.mark.asyncio
async def test_upsert_program_updates_existing(db: AsyncSession, store_a):
    await make_program(db, store_id=store_a.id, points_to_redeem=10)
    req = UpsertProgramRequest(
        earn_mode=EarnMode.PER_RECEIPT,
        points_to_redeem=20,
        reward_type=RewardType.DISCOUNT_FIXED,
        reward_value=Decimal("50"),
        reward_scope=RewardScope.ALL,
    )
    result = await svc.upsert_program(db, store_id=store_a.id, req=req)
    assert result.points_to_redeem == 20


@pytest.mark.asyncio
async def test_set_and_get_reward_products(db: AsyncSession, store_a):
    await make_program(
        db, store_id=store_a.id, reward_scope=RewardScope.SPECIFIC_PRODUCTS
    )
    latte = await make_product(db, store_id=store_a.id, name="Latte", price=Decimal("85"))
    muffin = await make_product(db, store_id=store_a.id, name="Muffin", price=Decimal("45"))

    products = await svc.set_reward_products(
        db, store_id=store_a.id, product_ids=[latte.id, muffin.id]
    )
    assert len(products) == 2
    names = {p.name for p in products}
    assert names == {"Latte", "Muffin"}

    # Replacing with a subset removes old entries
    products2 = await svc.set_reward_products(db, store_id=store_a.id, product_ids=[latte.id])
    assert len(products2) == 1
    assert products2[0].name == "Latte"


# ── lookup ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_lookup_returns_not_found_for_unknown_phone(db: AsyncSession, store_a):
    await make_program(db, store_id=store_a.id)
    result = await svc.lookup_member(db, store_id=store_a.id, phone="0800000000")
    assert result.found is False
    assert result.account is None


@pytest.mark.asyncio
async def test_lookup_returns_member_with_balance(db: AsyncSession, store_a):
    await make_program(db, store_id=store_a.id, points_to_redeem=10)
    _, account = await make_member(db, store_id=store_a.id, phone="0811111111", points_balance=5)

    result = await svc.lookup_member(db, store_id=store_a.id, phone="0811111111")
    assert result.found is True
    assert result.account.points_balance == 5
    assert result.account.customer_name == "Malee"
    assert result.reward_redeemable is False
    assert result.points_to_next_reward == 5


@pytest.mark.asyncio
async def test_lookup_reward_redeemable_when_balance_sufficient(db: AsyncSession, store_a):
    await make_program(db, store_id=store_a.id, points_to_redeem=10)
    await make_member(db, store_id=store_a.id, phone="0811111111", points_balance=10)

    result = await svc.lookup_member(db, store_id=store_a.id, phone="0811111111")
    assert result.reward_redeemable is True
    assert result.points_to_next_reward == 0


@pytest.mark.asyncio
async def test_lookup_eligible_products_for_specific_scope(db: AsyncSession, store_a):
    await make_program(
        db, store_id=store_a.id,
        points_to_redeem=5,
        reward_scope=RewardScope.SPECIFIC_PRODUCTS,
    )
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    await svc.set_reward_products(db, store_id=store_a.id, product_ids=[latte.id])
    await make_member(db, store_id=store_a.id, phone="0811111111", points_balance=5)

    result = await svc.lookup_member(db, store_id=store_a.id, phone="0811111111")
    assert result.reward_redeemable is True
    assert len(result.eligible_reward_products) == 1
    assert result.eligible_reward_products[0].name == "Latte"


@pytest.mark.asyncio
async def test_lookup_no_program_still_returns_member(db: AsyncSession, store_a):
    await make_member(db, store_id=store_a.id, phone="0811111111", points_balance=99)
    result = await svc.lookup_member(db, store_id=store_a.id, phone="0811111111")
    assert result.found is True
    assert result.program is None
    assert result.reward_redeemable is False


# ── register ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_register_creates_new_customer_and_account(db: AsyncSession, store_a, user_a):
    req = RegisterMemberRequest(name="Somchai", phone="0899999999")
    account = await svc.register_member(db, store_id=store_a.id, user_id=user_a.id, req=req)
    assert account.customer_name == "Somchai"
    assert account.phone == "0899999999"
    assert account.points_balance == 0


@pytest.mark.asyncio
async def test_register_links_to_existing_customer(db: AsyncSession, store_a, user_a):
    existing = Customer(store_id=store_a.id, name="Old Name", phone="0877777777")
    db.add(existing)
    await db.commit()

    req = RegisterMemberRequest(name="Old Name", phone="0877777777")
    account = await svc.register_member(db, store_id=store_a.id, user_id=user_a.id, req=req)
    assert account.customer_id == existing.id
    assert account.points_balance == 0


@pytest.mark.asyncio
async def test_register_conflicts_if_already_member(db: AsyncSession, store_a, user_a):
    await make_member(db, store_id=store_a.id, phone="0811111111")
    req = RegisterMemberRequest(name="Malee", phone="0811111111")
    with pytest.raises(Conflict):
        await svc.register_member(db, store_id=store_a.id, user_id=user_a.id, req=req)


# ── point earning (via orders service) ───────────────────────────────────────
# These tests call svc._earn_points directly to unit-test earning logic without
# going through the HTTP layer.

from datetime import date as _date
from unittest.mock import patch

from app.models.orders import Order as OrderModel
from app.enums import Channel, OrderStatus


async def _make_bare_order(db, *, store_id, user_id, subtotal=Decimal("150")) -> OrderModel:
    """Insert a minimal order row for use in earn/redeem tests."""
    from app.db.types import new_cuid
    order = OrderModel(
        id=new_cuid(),
        store_id=store_id,
        status=OrderStatus.PENDING,
        channel=Channel.DINE_IN,
        idempotency_key=new_cuid(),
        subtotal=subtotal,
        total=subtotal,
        created_by_id=user_id,
    )
    db.add(order)
    await db.flush()
    return order


@pytest.mark.asyncio
async def test_earn_per_receipt_adds_one_point(db: AsyncSession, store_a, user_a):
    program = await make_program(db, store_id=store_a.id, earn_mode=EarnMode.PER_RECEIPT)
    _, account = await make_member(db, store_id=store_a.id)

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id)
        earned = await svc._earn_points(
            db, store_id=store_a.id, account=account, program=program,
            order=order, total_items=1, user_id=user_a.id,
        )

    assert earned == 1
    await db.refresh(account)
    assert account.points_balance == 1
    assert account.lifetime_points_earned == 1


@pytest.mark.asyncio
async def test_earn_per_baht_floors_division(db: AsyncSession, store_a, user_a):
    program = await make_program(
        db, store_id=store_a.id,
        earn_mode=EarnMode.PER_BAHT,
        baht_per_point=Decimal("50"),
    )
    _, account = await make_member(db, store_id=store_a.id)

    async with db.begin():
        # 149 baht ÷ 50 = 2 (floor)
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id, subtotal=Decimal("149"))
        earned = await svc._earn_points(
            db, store_id=store_a.id, account=account, program=program,
            order=order, total_items=1, user_id=user_a.id,
        )

    assert earned == 2


@pytest.mark.asyncio
async def test_earn_per_item_uses_quantity_sum(db: AsyncSession, store_a, user_a):
    program = await make_program(db, store_id=store_a.id, earn_mode=EarnMode.PER_ITEM)
    _, account = await make_member(db, store_id=store_a.id)

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id)
        earned = await svc._earn_points(
            db, store_id=store_a.id, account=account, program=program,
            order=order, total_items=3, user_id=user_a.id,
        )

    assert earned == 3


@pytest.mark.asyncio
async def test_earn_skipped_below_min_order(db: AsyncSession, store_a, user_a):
    program = await make_program(
        db, store_id=store_a.id,
        earn_mode=EarnMode.PER_RECEIPT,
        min_order_baht=Decimal("100"),
    )
    _, account = await make_member(db, store_id=store_a.id)

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id, subtotal=Decimal("99"))
        earned = await svc._earn_points(
            db, store_id=store_a.id, account=account, program=program,
            order=order, total_items=1, user_id=user_a.id,
        )

    assert earned == 0
    await db.refresh(account)
    assert account.points_balance == 0


@pytest.mark.asyncio
async def test_earn_birthday_month_doubles_points(db: AsyncSession, store_a, user_a):
    program = await make_program(db, store_id=store_a.id, earn_mode=EarnMode.PER_RECEIPT)
    today = _date.today()
    _, account = await make_member(
        db, store_id=store_a.id,
        date_of_birth=_date(1990, today.month, 1),  # birthday month = this month
    )

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id)
        earned = await svc._earn_points(
            db, store_id=store_a.id, account=account, program=program,
            order=order, total_items=1, user_id=user_a.id,
        )

    assert earned == 2  # 1 base × 2 birthday


@pytest.mark.asyncio
async def test_earn_silver_tier_multiplier(db: AsyncSession, store_a, user_a):
    program = await make_program(
        db, store_id=store_a.id,
        earn_mode=EarnMode.PER_RECEIPT,
        tier_silver_threshold=100,
        silver_earn_multiplier=Decimal("1.5"),
    )
    _, account = await make_member(
        db, store_id=store_a.id,
        lifetime_points_earned=150,
        tier=MembershipTier.SILVER,
    )

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id)
        # today is not birthday month — patch to ensure no birthday bonus
        with patch("app.services.membership._date") as mock_date:
            mock_date.today.return_value = _date(2026, 1, 15)
            earned = await svc._earn_points(
                db, store_id=store_a.id, account=account, program=program,
                order=order, total_items=1, user_id=user_a.id,
            )

    assert earned == 1  # floor(1 × 1.5) = 1


@pytest.mark.asyncio
async def test_earn_records_point_transaction(db: AsyncSession, store_a, user_a):
    from sqlalchemy import select as sa_select
    program = await make_program(db, store_id=store_a.id, earn_mode=EarnMode.PER_RECEIPT)
    _, account = await make_member(db, store_id=store_a.id)

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id)
        await svc._earn_points(
            db, store_id=store_a.id, account=account, program=program,
            order=order, total_items=1, user_id=user_a.id,
        )

    tx = (await db.execute(
        sa_select(PointTransaction).where(PointTransaction.account_id == account.id)
    )).scalar_one()
    assert tx.type == PointTxType.EARN
    assert tx.delta == 1
    assert tx.balance_after == 1
    assert tx.order_id == order.id


# ── reward redemption ─────────────────────────────────────────────────────────

from app.core.errors import Unprocessable
from app.models.orders import OrderItem


async def _attach_order_item(db, *, order_id, product_id, product_name, unit_price, quantity=1):
    item = OrderItem(
        order_id=order_id,
        product_id=product_id,
        product_name=product_name,
        quantity=quantity,
        unit_price=unit_price,
        line_total=unit_price * quantity,
    )
    db.add(item)
    await db.flush()
    return item


@pytest.mark.asyncio
async def test_redeem_discount_fixed_reduces_total(db: AsyncSession, store_a, user_a):
    program = await make_program(
        db, store_id=store_a.id,
        points_to_redeem=10,
        reward_type=RewardType.DISCOUNT_FIXED,
        reward_value=Decimal("50"),
        reward_scope=RewardScope.ALL,
    )
    _, account = await make_member(db, store_id=store_a.id, points_balance=10)

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id, subtotal=Decimal("150"))
        discount = await svc._redeem_reward(
            db, store_id=store_a.id, account=account, program=program,
            order=order, reward_product_id=None, user_id=user_a.id,
        )

    assert discount == Decimal("50")
    await db.refresh(order)
    await db.refresh(account)
    assert order.discount == Decimal("50")
    assert order.total == Decimal("100")
    assert order.reward_redeemed is True
    assert account.points_balance == 0


@pytest.mark.asyncio
async def test_redeem_discount_percent_computed_from_subtotal(db: AsyncSession, store_a, user_a):
    program = await make_program(
        db, store_id=store_a.id,
        points_to_redeem=10,
        reward_type=RewardType.DISCOUNT_PERCENT,
        reward_value=Decimal("20"),
        reward_scope=RewardScope.ALL,
    )
    _, account = await make_member(db, store_id=store_a.id, points_balance=10)

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id, subtotal=Decimal("200"))
        discount = await svc._redeem_reward(
            db, store_id=store_a.id, account=account, program=program,
            order=order, reward_product_id=None, user_id=user_a.id,
        )

    assert discount == Decimal("40.00")  # 200 × 20%
    await db.refresh(order)
    assert order.total == Decimal("160.00")


@pytest.mark.asyncio
async def test_redeem_discount_capped_at_subtotal(db: AsyncSession, store_a, user_a):
    program = await make_program(
        db, store_id=store_a.id,
        points_to_redeem=10,
        reward_type=RewardType.DISCOUNT_FIXED,
        reward_value=Decimal("500"),  # discount > subtotal
        reward_scope=RewardScope.ALL,
    )
    _, account = await make_member(db, store_id=store_a.id, points_balance=10)

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id, subtotal=Decimal("80"))
        discount = await svc._redeem_reward(
            db, store_id=store_a.id, account=account, program=program,
            order=order, reward_product_id=None, user_id=user_a.id,
        )

    assert discount == Decimal("80")
    await db.refresh(order)
    assert order.total == Decimal("0")


@pytest.mark.asyncio
async def test_redeem_free_item_uses_product_price(db: AsyncSession, store_a, user_a):
    latte = await make_product(db, store_id=store_a.id, name="Latte", price=Decimal("85"))
    program = await make_program(
        db, store_id=store_a.id,
        points_to_redeem=10,
        reward_type=RewardType.FREE_ITEM,
        reward_scope=RewardScope.ALL,
    )
    _, account = await make_member(db, store_id=store_a.id, points_balance=10)

    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id, subtotal=Decimal("85"))
        await _attach_order_item(
            db, order_id=order.id, product_id=latte.id,
            product_name="Latte", unit_price=Decimal("85"),
        )
        discount = await svc._redeem_reward(
            db, store_id=store_a.id, account=account, program=program,
            order=order, reward_product_id=latte.id, user_id=user_a.id,
        )

    assert discount == Decimal("85")


@pytest.mark.asyncio
async def test_redeem_free_item_rejects_out_of_scope_product(db: AsyncSession, store_a, user_a):
    cat = await make_category(db, store_id=store_a.id, name="Food")
    drink = await make_product(db, store_id=store_a.id, name="Latte", price=Decimal("85"))
    # drink has no category → not in the food category
    program = await make_program(
        db, store_id=store_a.id,
        points_to_redeem=10,
        reward_type=RewardType.FREE_ITEM,
        reward_scope=RewardScope.CATEGORY,
        reward_category_id=cat.id,
    )
    _, account = await make_member(db, store_id=store_a.id, points_balance=10)

    with pytest.raises(Unprocessable):
        async with db.begin():
            order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id, subtotal=Decimal("85"))
            await _attach_order_item(
                db, order_id=order.id, product_id=drink.id,
                product_name="Latte", unit_price=Decimal("85"),
            )
            await svc._redeem_reward(
                db, store_id=store_a.id, account=account, program=program,
                order=order, reward_product_id=drink.id, user_id=user_a.id,
            )


@pytest.mark.asyncio
async def test_redeem_fails_with_insufficient_points(db: AsyncSession, store_a, user_a):
    program = await make_program(db, store_id=store_a.id, points_to_redeem=10)
    _, account = await make_member(db, store_id=store_a.id, points_balance=9)

    with pytest.raises(Unprocessable):
        async with db.begin():
            order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id)
            await svc._redeem_reward(
                db, store_id=store_a.id, account=account, program=program,
                order=order, reward_product_id=None, user_id=user_a.id,
            )


# ── void reversal ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reverse_points_restores_earned_points_on_void(db: AsyncSession, store_a, user_a):
    from app.db.types import new_cuid

    program = await make_program(db, store_id=store_a.id, earn_mode=EarnMode.PER_RECEIPT)
    _, account = await make_member(db, store_id=store_a.id, points_balance=5, lifetime_points_earned=5)

    # Simulate an order that already earned 3 points
    async with db.begin():
        order = OrderModel(
            store_id=store_a.id,
            status=OrderStatus.PAID,
            channel=Channel.DINE_IN,
            idempotency_key=new_cuid(),
            subtotal=Decimal("150"),
            total=Decimal("150"),
            created_by_id=user_a.id,
            member_id=account.id,
            points_earned=3,
            reward_redeemed=False,
        )
        db.add(order)

    async with db.begin():
        await svc._reverse_points(db, order=order, user_id=user_a.id)

    await db.refresh(account)
    assert account.points_balance == 2           # 5 - 3
    assert account.lifetime_points_earned == 2   # 5 - 3


@pytest.mark.asyncio
async def test_reverse_points_restores_redeemed_points_on_void(db: AsyncSession, store_a, user_a):
    from app.db.types import new_cuid

    program = await make_program(db, store_id=store_a.id, points_to_redeem=10)
    _, account = await make_member(db, store_id=store_a.id, points_balance=0)

    async with db.begin():
        order = OrderModel(
            store_id=store_a.id,
            status=OrderStatus.PAID,
            channel=Channel.DINE_IN,
            idempotency_key=new_cuid(),
            subtotal=Decimal("150"),
            total=Decimal("100"),
            discount=Decimal("50"),
            created_by_id=user_a.id,
            member_id=account.id,
            points_earned=0,
            reward_redeemed=True,
        )
        db.add(order)

    async with db.begin():
        await svc._reverse_points(db, order=order, user_id=user_a.id)

    await db.refresh(account)
    assert account.points_balance == 10   # redeemed 10 points restored


@pytest.mark.asyncio
async def test_reverse_points_noop_when_no_member(db: AsyncSession, store_a, user_a):
    from app.db.types import new_cuid

    async with db.begin():
        order = OrderModel(
            store_id=store_a.id,
            status=OrderStatus.PAID,
            channel=Channel.DINE_IN,
            idempotency_key=new_cuid(),
            subtotal=Decimal("150"),
            total=Decimal("150"),
            created_by_id=user_a.id,
            member_id=None,
            points_earned=None,
            reward_redeemed=False,
        )
        db.add(order)

    # Should not raise — no member on order
    async with db.begin():
        await svc._reverse_points(db, order=order, user_id=user_a.id)


# ── member management ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_members_returns_paginated_results(db: AsyncSession, store_a):
    await make_member(db, store_id=store_a.id, name="Alice", phone="0811111111")
    await make_member(db, store_id=store_a.id, name="Bob", phone="0822222222")

    result = await svc.list_members(db, store_id=store_a.id)
    assert result.total == 2
    assert len(result.items) == 2


@pytest.mark.asyncio
async def test_list_members_filters_by_name(db: AsyncSession, store_a):
    await make_member(db, store_id=store_a.id, name="Alice", phone="0811111111")
    await make_member(db, store_id=store_a.id, name="Bob", phone="0822222222")

    result = await svc.list_members(db, store_id=store_a.id, name="ali")
    assert result.total == 1
    assert result.items[0].customer_name == "Alice"


@pytest.mark.asyncio
async def test_get_member_returns_recent_transactions(db: AsyncSession, store_a, user_a):
    program = await make_program(db, store_id=store_a.id, earn_mode=EarnMode.PER_RECEIPT)
    _, account = await make_member(db, store_id=store_a.id)

    # Create a transaction
    async with db.begin():
        order = await _make_bare_order(db, store_id=store_a.id, user_id=user_a.id)
        await svc._earn_points(
            db, store_id=store_a.id, account=account, program=program,
            order=order, total_items=1, user_id=user_a.id,
        )

    result = await svc.get_member(db, store_id=store_a.id, account_id=account.id)
    assert len(result.recent_transactions) == 1
    assert result.recent_transactions[0].type == PointTxType.EARN
    assert result.recent_transactions[0].delta == 1


@pytest.mark.asyncio
async def test_adjust_points_adds_delta(db: AsyncSession, store_a, user_a):
    _, account = await make_member(db, store_id=store_a.id, points_balance=10)

    result = await svc.adjust_points(
        db, store_id=store_a.id, account_id=account.id, user_id=user_a.id,
        req=AdjustPointsRequest(delta=5, note="Goodwill adjustment"),
    )
    assert result.points_balance == 15


@pytest.mark.asyncio
async def test_adjust_points_deducts_delta(db: AsyncSession, store_a, user_a):
    _, account = await make_member(db, store_id=store_a.id, points_balance=10)

    result = await svc.adjust_points(
        db, store_id=store_a.id, account_id=account.id, user_id=user_a.id,
        req=AdjustPointsRequest(delta=-5, note="Correction"),
    )
    assert result.points_balance == 5


@pytest.mark.asyncio
async def test_adjust_points_rejects_negative_result(db: AsyncSession, store_a, user_a):
    _, account = await make_member(db, store_id=store_a.id, points_balance=3)

    with pytest.raises(Unprocessable):
        await svc.adjust_points(
            db, store_id=store_a.id, account_id=account.id, user_id=user_a.id,
            req=AdjustPointsRequest(delta=-10, note="Too big"),
        )


@pytest.mark.asyncio
async def test_list_members_does_not_leak_across_stores(db: AsyncSession, store_a, store_b):
    await make_member(db, store_id=store_a.id, name="Store-A Member", phone="0811111111")
    await make_member(db, store_id=store_b.id, name="Store-B Member", phone="0822222222")

    result = await svc.list_members(db, store_id=store_a.id)
    assert result.total == 1
    assert result.items[0].customer_name == "Store-A Member"


# ── backend-added customers (no loyalty account yet) ───────────────────────────


async def _make_customer_only(db: AsyncSession, *, store_id: str, name: str, phone: str) -> Customer:
    """A customer added directly in the backend — no MembershipAccount yet."""
    customer = Customer(store_id=store_id, name=name, phone=phone)
    db.add(customer)
    await db.commit()
    return customer


@pytest.mark.asyncio
async def test_list_members_includes_backend_customer_without_account(db: AsyncSession, store_a):
    await make_member(db, store_id=store_a.id, name="With Account", phone="0811111111")
    customer = await _make_customer_only(db, store_id=store_a.id, name="Backend Only", phone="0899999999")

    result = await svc.list_members(db, store_id=store_a.id)
    assert result.total == 2
    assert {m.customer_name for m in result.items} == {"With Account", "Backend Only"}

    backend = next(m for m in result.items if m.customer_name == "Backend Only")
    assert backend.id == customer.id  # falls back to customer id
    assert backend.points_balance == 0
    assert backend.tier == MembershipTier.NONE


@pytest.mark.asyncio
async def test_list_members_search_finds_backend_customer(db: AsyncSession, store_a):
    customer = await _make_customer_only(db, store_id=store_a.id, name="Somchai", phone="0861234567")

    by_phone = await svc.list_members(db, store_id=store_a.id, phone="0861234")
    assert by_phone.total == 1
    assert by_phone.items[0].customer_name == "Somchai"

    by_name = await svc.list_members(db, store_id=store_a.id, name="somc")
    assert by_name.total == 1
    assert by_name.items[0].id == customer.id


@pytest.mark.asyncio
async def test_get_member_synthesizes_for_account_less_customer(db: AsyncSession, store_a):
    customer = await _make_customer_only(db, store_id=store_a.id, name="No Points", phone="0850000000")

    result = await svc.get_member(db, store_id=store_a.id, account_id=customer.id)
    assert result.id == customer.id
    assert result.customer_name == "No Points"
    assert result.points_balance == 0
    assert result.tier == MembershipTier.NONE
    assert result.recent_transactions == []


@pytest.mark.asyncio
async def test_adjust_points_provisions_account_for_backend_customer(db: AsyncSession, store_a, user_a):
    from sqlalchemy import select

    customer = await _make_customer_only(db, store_id=store_a.id, name="Upgrade Me", phone="0840000000")

    result = await svc.adjust_points(
        db, store_id=store_a.id, account_id=customer.id, user_id=user_a.id,
        req=AdjustPointsRequest(delta=15, note="Welcome bonus"),
    )
    assert result.points_balance == 15
    assert result.customer_name == "Upgrade Me"
    assert len(result.recent_transactions) == 1
    assert result.recent_transactions[0].delta == 15

    # A real account now exists and the returned id points to it.
    account = (await db.execute(
        select(MembershipAccount).where(MembershipAccount.customer_id == customer.id)
    )).scalar_one()
    assert result.id == account.id
    assert account.points_balance == 15
