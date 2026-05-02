from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import Conflict, NotFound
from app.enums import CashSessionStatus
from app.models.operations import CashPayout, CashSession, Promotion, Protocol, ProtocolLog, ProtocolTask
from app.schemas.operations import (
    CashPayoutCreate,
    CashSessionClose,
    CashSessionCreate,
    PromotionCreate,
    PromotionUpdate,
    ProtocolCreate,
    ProtocolLogCreate,
)


# ── Cash ──────────────────────────────────────────────────────────────────────

async def get_today_session(db: AsyncSession, *, store_id: str) -> CashSession | None:
    today = date.today()
    result = await db.execute(
        select(CashSession)
        .options(selectinload(CashSession.payouts))
        .where(CashSession.store_id == store_id, CashSession.session_date == today)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def open_cash_session(
    db: AsyncSession, *, store_id: str, user_id: str, payload: CashSessionCreate
) -> CashSession:
    existing = await db.execute(
        select(CashSession).where(
            CashSession.store_id == store_id,
            CashSession.session_date == payload.session_date,
            CashSession.status == CashSessionStatus.OPEN,
        )
    )
    if existing.scalar_one_or_none():
        raise Conflict("An open cash session already exists for this date")

    session = CashSession(
        store_id=store_id,
        session_date=payload.session_date,
        opening_balance=payload.opening_balance,
        status=CashSessionStatus.OPEN,
        opened_by_id=user_id,
        notes=payload.notes,
    )
    async with db.begin():
        db.add(session)
    await db.refresh(session, ["payouts"])
    return session


async def close_cash_session(
    db: AsyncSession, *, store_id: str, session_id: str, user_id: str, payload: CashSessionClose
) -> CashSession:
    session = await db.get(CashSession, session_id)
    if not session or session.store_id != store_id:
        raise NotFound("Cash session not found")
    if session.status == CashSessionStatus.CLOSED:
        raise Conflict("Session is already closed")

    async with db.begin():
        session.closing_balance = payload.closing_balance
        session.status = CashSessionStatus.CLOSED
        session.closed_by_id = user_id
        if payload.notes:
            session.notes = payload.notes
        db.add(session)
    await db.refresh(session, ["payouts"])
    return session


async def add_payout(
    db: AsyncSession, *, store_id: str, session_id: str, user_id: str, payload: CashPayoutCreate
) -> CashSession:
    session = await db.get(CashSession, session_id)
    if not session or session.store_id != store_id:
        raise NotFound("Cash session not found")
    if session.status == CashSessionStatus.CLOSED:
        raise Conflict("Cannot add payout to a closed session")

    payout = CashPayout(
        cash_session_id=session_id,
        store_id=store_id,
        amount=payload.amount,
        payout_type=payload.payout_type,
        description=payload.description,
        created_by_id=user_id,
    )
    async with db.begin():
        db.add(payout)
    await db.refresh(session, ["payouts"])
    return session


# ── Promotions ────────────────────────────────────────────────────────────────

async def list_promotions(db: AsyncSession, *, store_id: str) -> list[Promotion]:
    result = await db.execute(
        select(Promotion)
        .where(Promotion.store_id == store_id)
        .order_by(Promotion.created_at.desc())
    )
    return list(result.scalars())


async def create_promotion(
    db: AsyncSession, *, store_id: str, user_id: str, payload: PromotionCreate
) -> Promotion:
    promo = Promotion(
        store_id=store_id,
        created_by_id=user_id,
        **payload.model_dump(),
    )
    async with db.begin():
        db.add(promo)
    await db.refresh(promo)
    return promo


async def update_promotion(
    db: AsyncSession, *, store_id: str, promo_id: str, payload: PromotionUpdate
) -> Promotion:
    promo = await db.get(Promotion, promo_id)
    if not promo or promo.store_id != store_id:
        raise NotFound("Promotion not found")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(promo, field, value)

    async with db.begin():
        db.add(promo)
    await db.refresh(promo)
    return promo


async def delete_promotion(db: AsyncSession, *, store_id: str, promo_id: str) -> None:
    promo = await db.get(Promotion, promo_id)
    if not promo or promo.store_id != store_id:
        raise NotFound("Promotion not found")
    async with db.begin():
        await db.delete(promo)


# ── Protocols ─────────────────────────────────────────────────────────────────

async def list_protocols(db: AsyncSession, *, store_id: str) -> list[Protocol]:
    result = await db.execute(
        select(Protocol)
        .options(selectinload(Protocol.tasks))
        .where(Protocol.store_id == store_id, Protocol.is_active.is_(True))
        .order_by(Protocol.created_at.asc())
    )
    return list(result.scalars())


async def create_protocol(
    db: AsyncSession, *, store_id: str, user_id: str, payload: ProtocolCreate
) -> Protocol:
    protocol = Protocol(
        store_id=store_id,
        created_by_id=user_id,
        name=payload.name,
        description=payload.description,
        frequency=payload.frequency,
    )
    tasks = [
        ProtocolTask(title=t.title, sort_order=t.sort_order)
        for t in payload.tasks
    ]
    protocol.tasks = tasks

    async with db.begin():
        db.add(protocol)
    await db.refresh(protocol, ["tasks"])
    return protocol


async def get_today_protocol_logs(db: AsyncSession, *, store_id: str) -> list[ProtocolLog]:
    today = date.today()
    result = await db.execute(
        select(ProtocolLog).where(
            ProtocolLog.store_id == store_id,
            ProtocolLog.log_date == today,
        )
    )
    return list(result.scalars())


async def log_protocol(
    db: AsyncSession, *, store_id: str, user_id: str, payload: ProtocolLogCreate
) -> ProtocolLog:
    # upsert: one log per protocol per day per store
    existing = await db.execute(
        select(ProtocolLog).where(
            ProtocolLog.protocol_id == payload.protocol_id,
            ProtocolLog.store_id == store_id,
            ProtocolLog.log_date == payload.log_date,
        )
    )
    log = existing.scalar_one_or_none()

    async with db.begin():
        if log:
            log.completed_task_ids = payload.completed_task_ids
            log.completed_by_id = user_id
            db.add(log)
        else:
            log = ProtocolLog(
                protocol_id=payload.protocol_id,
                store_id=store_id,
                log_date=payload.log_date,
                completed_task_ids=payload.completed_task_ids,
                completed_by_id=user_id,
            )
            db.add(log)
    await db.refresh(log)
    return log
