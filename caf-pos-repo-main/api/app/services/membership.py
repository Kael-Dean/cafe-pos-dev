import logging
from datetime import date as _date
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound, Unprocessable
from app.enums import EarnMode, MembershipTier, PointTxType, RewardScope, RewardType
from app.models.catalog import Category, Product
from app.models.customers import Customer
from app.models.membership import (
    MembershipAccount,
    MembershipProgram,
    MembershipRewardProduct,
    PointTransaction,
)
from app.models.orders import Order
from app.schemas.membership import (
    AccountRead,
    AdjustPointsRequest,
    LookupResponse,
    LookupRewardInfo,
    MemberRead,
    MembersPage,
    PointTransactionRead,
    ProgramRead,
    RegisterMemberRequest,
    RewardProductRead,
    UpsertProgramRequest,
)

logger = logging.getLogger(__name__)

_DEFAULT_PAGE = 50
_MAX_PAGE = 200
_RECENT_TX_LIMIT = 20


async def get_program(db: AsyncSession, *, store_id: str) -> ProgramRead | None:
    row = (await db.execute(
        select(MembershipProgram).where(MembershipProgram.store_id == store_id)
    )).scalar_one_or_none()
    return ProgramRead.model_validate(row) if row else None


async def upsert_program(
    db: AsyncSession, *, store_id: str, req: UpsertProgramRequest
) -> ProgramRead:
    async with db.begin():
        existing = (await db.execute(
            select(MembershipProgram).where(MembershipProgram.store_id == store_id)
        )).scalar_one_or_none()

        if existing:
            for field, value in req.model_dump().items():
                setattr(existing, field, value)
            program = existing
        else:
            program = MembershipProgram(store_id=store_id, **req.model_dump())
            db.add(program)

        await db.flush()
        await db.refresh(program)

    return ProgramRead.model_validate(program)


async def get_reward_products(db: AsyncSession, *, store_id: str) -> list[RewardProductRead]:
    program = await _load_program(db, store_id=store_id)
    rows = list((await db.execute(
        select(Product)
        .join(MembershipRewardProduct, MembershipRewardProduct.product_id == Product.id)
        .where(MembershipRewardProduct.program_id == program.id, Product.is_active.is_(True))
    )).scalars())
    return [RewardProductRead.model_validate(p) for p in rows]


async def set_reward_products(
    db: AsyncSession, *, store_id: str, product_ids: list[str]
) -> list[RewardProductRead]:
    async with db.begin():
        program = await _load_program(db, store_id=store_id)

        if product_ids:
            valid_ids = list((await db.execute(
                select(Product.id).where(
                    Product.id.in_(product_ids),
                    Product.store_id == store_id,
                    Product.is_active.is_(True),
                )
            )).scalars())
            invalid = set(product_ids) - set(valid_ids)
            if invalid:
                raise Unprocessable(
                    f"Products not found in this store: {', '.join(sorted(invalid))}"
                )

        await db.execute(
            delete(MembershipRewardProduct).where(
                MembershipRewardProduct.program_id == program.id
            )
        )
        for pid in product_ids:
            db.add(MembershipRewardProduct(program_id=program.id, product_id=pid))

    result = await get_reward_products(db, store_id=store_id)
    await db.commit()
    return result


async def _load_program(db: AsyncSession, *, store_id: str) -> MembershipProgram:
    program = (await db.execute(
        select(MembershipProgram).where(MembershipProgram.store_id == store_id)
    )).scalar_one_or_none()
    if not program:
        raise NotFound("Membership program not configured for this store")
    return program


async def lookup_member(
    db: AsyncSession, *, store_id: str, phone: str
) -> LookupResponse:
    row = (await db.execute(
        select(MembershipAccount, Customer.name, Customer.phone)
        .join(Customer, MembershipAccount.customer_id == Customer.id)
        .where(
            MembershipAccount.store_id == store_id,
            Customer.phone == phone,
            Customer.is_active.is_(True),
        )
    )).first()

    if not row:
        return LookupResponse(found=False)

    account, customer_name, customer_phone = row
    account_read = AccountRead.model_validate({
        **account.__dict__,
        "customer_name": customer_name,
        "phone": customer_phone,
    })

    program = (await db.execute(
        select(MembershipProgram).where(
            MembershipProgram.store_id == store_id,
            MembershipProgram.is_active.is_(True),
        )
    )).scalar_one_or_none()

    if not program:
        return LookupResponse(found=True, account=account_read)

    reward_redeemable = account.points_balance >= program.points_to_redeem
    points_to_next = max(0, program.points_to_redeem - account.points_balance)

    eligible: list[RewardProductRead] = []
    if reward_redeemable:
        eligible = await _get_eligible_reward_products(db, program=program, store_id=store_id)

    category_name: str | None = None
    if program.reward_scope == RewardScope.CATEGORY and program.reward_category_id:
        category_name = (await db.execute(
            select(Category.name).where(Category.id == program.reward_category_id)
        )).scalar_one_or_none()

    return LookupResponse(
        found=True,
        account=account_read,
        program=LookupRewardInfo(
            points_to_redeem=program.points_to_redeem,
            reward_type=program.reward_type,
            reward_scope=program.reward_scope,
            reward_category_name=category_name,
        ),
        reward_redeemable=reward_redeemable,
        points_to_next_reward=points_to_next if not reward_redeemable else 0,
        eligible_reward_products=eligible,
    )


async def register_member(
    db: AsyncSession, *, store_id: str, user_id: str, req: RegisterMemberRequest
) -> AccountRead:
    customer = (await db.execute(
        select(Customer).where(
            Customer.store_id == store_id,
            Customer.phone == req.phone,
            Customer.is_active.is_(True),
        )
    )).scalar_one_or_none()

    if customer:
        existing_account = (await db.execute(
            select(MembershipAccount).where(MembershipAccount.customer_id == customer.id)
        )).scalar_one_or_none()
        if existing_account:
            raise Conflict("This phone number is already registered as a member")
    else:
        customer = Customer(store_id=store_id, name=req.name, phone=req.phone)
        db.add(customer)
        await db.flush()

    account = MembershipAccount(
        customer_id=customer.id,
        store_id=store_id,
        date_of_birth=req.date_of_birth,
    )
    db.add(account)
    await db.flush()
    await db.commit()
    await db.refresh(account)
    await db.refresh(customer)

    return AccountRead.model_validate({
        **account.__dict__,
        "customer_name": customer.name,
        "phone": customer.phone,
    })


async def _get_eligible_reward_products(
    db: AsyncSession, *, program: MembershipProgram, store_id: str
) -> list[RewardProductRead]:
    if program.reward_scope == RewardScope.ALL:
        return []
    if program.reward_scope == RewardScope.CATEGORY and program.reward_category_id:
        rows = list((await db.execute(
            select(Product).where(
                Product.store_id == store_id,
                Product.category_id == program.reward_category_id,
                Product.is_active.is_(True),
            )
        )).scalars())
    else:  # SPECIFIC_PRODUCTS
        rows = list((await db.execute(
            select(Product)
            .join(MembershipRewardProduct, MembershipRewardProduct.product_id == Product.id)
            .where(MembershipRewardProduct.program_id == program.id, Product.is_active.is_(True))
        )).scalars())
    return [RewardProductRead.model_validate(p) for p in rows]


# ---------------------------------------------------------------------------
# Point earning helpers
# ---------------------------------------------------------------------------


async def _earn_points(
    db: AsyncSession,
    *,
    store_id: str,
    account: MembershipAccount,
    program: MembershipProgram,
    order: Order,
    total_items: int,
    user_id: str,
) -> int:
    """Compute and record earned points. Must be called inside an active db.begin()."""
    if program.min_order_baht and order.subtotal < program.min_order_baht:
        return 0

    if program.earn_mode == EarnMode.PER_RECEIPT:
        base_points = 1
    elif program.earn_mode == EarnMode.PER_BAHT:
        base_points = int(order.subtotal // program.baht_per_point)
    else:  # PER_ITEM
        base_points = total_items

    if base_points <= 0:
        return 0

    today = _date.today()
    birthday_multiplier = Decimal("2.0") if (
        account.date_of_birth and account.date_of_birth.month == today.month
    ) else Decimal("1.0")

    tier_multiplier = _get_tier_multiplier(account, program)

    total = int(Decimal(str(base_points)) * birthday_multiplier * tier_multiplier)
    if total <= 0:
        return 0

    account.points_balance += total
    account.lifetime_points_earned += total
    account.tier = _compute_tier(account, program)

    db.add(PointTransaction(
        account_id=account.id,
        store_id=store_id,
        type=PointTxType.EARN,
        delta=total,
        balance_after=account.points_balance,
        order_id=order.id,
        created_by_id=user_id,
    ))

    return total


def _compute_tier(account: MembershipAccount, program: MembershipProgram) -> MembershipTier:
    lpe = account.lifetime_points_earned
    if program.tier_gold_threshold and lpe >= program.tier_gold_threshold:
        return MembershipTier.GOLD
    if program.tier_silver_threshold and lpe >= program.tier_silver_threshold:
        return MembershipTier.SILVER
    if program.tier_bronze_threshold and lpe >= program.tier_bronze_threshold:
        return MembershipTier.BRONZE
    return MembershipTier.NONE


def _get_tier_multiplier(account: MembershipAccount, program: MembershipProgram) -> Decimal:
    if account.tier == MembershipTier.GOLD:
        return program.gold_earn_multiplier
    if account.tier == MembershipTier.SILVER:
        return program.silver_earn_multiplier
    if account.tier == MembershipTier.BRONZE:
        return program.bronze_earn_multiplier
    return Decimal("1.0")


async def _load_account_for_update(
    db: AsyncSession, *, account_id: str, store_id: str
) -> MembershipAccount:
    """SELECT FOR UPDATE to prevent concurrent earn race conditions."""
    account = (await db.execute(
        select(MembershipAccount)
        .where(MembershipAccount.id == account_id, MembershipAccount.store_id == store_id)
        .with_for_update()
    )).scalar_one_or_none()
    if not account:
        raise NotFound("Membership account not found")
    return account


async def _get_active_program(
    db: AsyncSession, *, store_id: str
) -> MembershipProgram | None:
    return (await db.execute(
        select(MembershipProgram).where(
            MembershipProgram.store_id == store_id,
            MembershipProgram.is_active.is_(True),
        )
    )).scalar_one_or_none()


async def _redeem_reward(
    db: AsyncSession,
    *,
    store_id: str,
    account: MembershipAccount,
    program: MembershipProgram,
    order: Order,
    reward_product_id: str | None,
    user_id: str,
) -> Decimal:
    """Apply reward discount to order. Returns discount amount. Must be inside db.begin()."""
    if account.points_balance < program.points_to_redeem:
        raise Unprocessable(
            f"Insufficient points: need {program.points_to_redeem}, have {account.points_balance}"
        )

    if program.reward_type == RewardType.DISCOUNT_FIXED:
        discount = program.reward_value
    elif program.reward_type == RewardType.DISCOUNT_PERCENT:
        discount = (order.subtotal * program.reward_value / Decimal("100")).quantize(Decimal("0.01"))
    else:  # FREE_ITEM
        if not reward_product_id:
            raise Unprocessable("reward_product_id is required for FREE_ITEM rewards")
        discount = await _validate_free_item(
            db, program=program, order=order, product_id=reward_product_id
        )

    order.discount = min(order.discount + discount, order.subtotal)
    order.total = order.subtotal - order.discount + order.tax
    order.reward_redeemed = True

    account.points_balance -= program.points_to_redeem
    db.add(PointTransaction(
        account_id=account.id,
        store_id=store_id,
        type=PointTxType.REDEEM,
        delta=-program.points_to_redeem,
        balance_after=account.points_balance,
        order_id=order.id,
        created_by_id=user_id,
    ))

    return discount


async def _validate_free_item(
    db: AsyncSession,
    *,
    program: MembershipProgram,
    order: Order,
    product_id: str,
) -> Decimal:
    from app.models.orders import OrderItem

    item = (await db.execute(
        select(OrderItem).where(
            OrderItem.order_id == order.id,
            OrderItem.product_id == product_id,
        )
    )).scalar_one_or_none()
    if not item:
        raise Unprocessable("Reward product is not in this order")

    if program.reward_scope == RewardScope.CATEGORY:
        product = (await db.execute(
            select(Product).where(Product.id == product_id)
        )).scalar_one_or_none()
        if not product or product.category_id != program.reward_category_id:
            raise Unprocessable("Reward product is not in the eligible category")

    elif program.reward_scope == RewardScope.SPECIFIC_PRODUCTS:
        rp = (await db.execute(
            select(MembershipRewardProduct).where(
                MembershipRewardProduct.program_id == program.id,
                MembershipRewardProduct.product_id == product_id,
            )
        )).scalar_one_or_none()
        if not rp:
            raise Unprocessable("Reward product is not in the eligible product list")

    return item.unit_price


# ---------------------------------------------------------------------------
# Void reversal
# ---------------------------------------------------------------------------


async def _reverse_points(
    db: AsyncSession, *, order: Order, user_id: str
) -> None:
    """Reverse earn and/or redeem for a voided order. Must be called inside db.begin()."""
    if not order.member_id:
        return

    account = (await db.execute(
        select(MembershipAccount)
        .where(MembershipAccount.id == order.member_id)
        .with_for_update()
    )).scalar_one_or_none()
    if not account:
        return

    if order.points_earned and order.points_earned > 0:
        account.points_balance = max(0, account.points_balance - order.points_earned)
        account.lifetime_points_earned = max(0, account.lifetime_points_earned - order.points_earned)
        db.add(PointTransaction(
            account_id=account.id,
            store_id=order.store_id,
            type=PointTxType.ADJUST,
            delta=-order.points_earned,
            balance_after=account.points_balance,
            order_id=order.id,
            note=f"Auto-reversed: order #{order.order_number} voided",
            created_by_id=user_id,
        ))

    if order.reward_redeemed:
        program = (await db.execute(
            select(MembershipProgram).where(MembershipProgram.store_id == order.store_id)
        )).scalar_one_or_none()
        if program:
            account.points_balance += program.points_to_redeem
            db.add(PointTransaction(
                account_id=account.id,
                store_id=order.store_id,
                type=PointTxType.ADJUST,
                delta=program.points_to_redeem,
                balance_after=account.points_balance,
                order_id=order.id,
                note=f"Auto-reversed: order #{order.order_number} voided (reward restored)",
                created_by_id=user_id,
            ))


# ---------------------------------------------------------------------------
# Stubs — full implementations added in Task 9
# ---------------------------------------------------------------------------

async def list_members(
    db: AsyncSession,
    *,
    store_id: str,
    name: str | None = None,
    phone: str | None = None,
    page: int = 1,
    limit: int = _DEFAULT_PAGE,
) -> MembersPage:
    limit = min(limit, _MAX_PAGE)
    offset = (max(page, 1) - 1) * limit

    stmt = (
        select(MembershipAccount, Customer.name, Customer.phone)
        .join(Customer, MembershipAccount.customer_id == Customer.id)
        .where(MembershipAccount.store_id == store_id, Customer.is_active.is_(True))
        .order_by(MembershipAccount.joined_at.desc())
    )
    if name:
        stmt = stmt.where(Customer.name.ilike(f"%{name}%"))
    if phone:
        stmt = stmt.where(Customer.phone.ilike(f"%{phone}%"))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = list((await db.execute(stmt.offset(offset).limit(limit))).all())

    items = [
        AccountRead.model_validate({**acc.__dict__, "customer_name": cname, "phone": cphone})
        for acc, cname, cphone in rows
    ]
    return MembersPage(items=items, total=total, page=page, limit=limit)


async def get_member(
    db: AsyncSession, *, store_id: str, account_id: str
) -> MemberRead:
    row = (await db.execute(
        select(MembershipAccount, Customer.name, Customer.phone)
        .join(Customer, MembershipAccount.customer_id == Customer.id)
        .where(
            MembershipAccount.id == account_id,
            MembershipAccount.store_id == store_id,
            Customer.is_active.is_(True),
        )
    )).first()
    if not row:
        raise NotFound("Member not found")

    account, customer_name, customer_phone = row

    tx_rows = list((await db.execute(
        select(PointTransaction)
        .where(PointTransaction.account_id == account_id)
        .order_by(PointTransaction.created_at.desc())
        .limit(_RECENT_TX_LIMIT)
    )).scalars())

    return MemberRead.model_validate({
        **account.__dict__,
        "customer_name": customer_name,
        "phone": customer_phone,
        "recent_transactions": [PointTransactionRead.model_validate(tx) for tx in tx_rows],
    })


async def adjust_points(
    db: AsyncSession,
    *,
    store_id: str,
    account_id: str,
    user_id: str,
    req: AdjustPointsRequest,
) -> MemberRead:
    async with db.begin():
        account = await _load_account_for_update(db, account_id=account_id, store_id=store_id)
        new_balance = account.points_balance + req.delta
        if new_balance < 0:
            raise Unprocessable(
                f"Adjustment would bring balance to {new_balance}. "
                f"Maximum deduction allowed: {account.points_balance}"
            )
        account.points_balance = new_balance
        if req.delta > 0:
            account.lifetime_points_earned += req.delta
        db.add(PointTransaction(
            account_id=account.id,
            store_id=store_id,
            type=PointTxType.ADJUST,
            delta=req.delta,
            balance_after=new_balance,
            note=req.note,
            created_by_id=user_id,
        ))

    return await get_member(db, store_id=store_id, account_id=account_id)
