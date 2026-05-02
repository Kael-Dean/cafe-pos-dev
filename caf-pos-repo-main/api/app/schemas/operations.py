from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class _OrmBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── Cash ─────────────────────────────────────────────────────────────────────

class CashPayoutCreate(BaseModel):
    amount: Decimal = Field(gt=0)
    payout_type: str = Field(pattern="^(PAYOUT|PETTY_CASH|WITHDRAWAL)$")
    description: str = Field(min_length=1, max_length=255)


class CashPayoutRead(_OrmBase):
    id: str
    cash_session_id: str
    amount: Decimal
    payout_type: str
    description: str
    created_by_id: str
    created_at: datetime


class CashSessionCreate(BaseModel):
    session_date: date
    opening_balance: Decimal = Field(ge=0)
    notes: str | None = None


class CashSessionClose(BaseModel):
    closing_balance: Decimal = Field(ge=0)
    notes: str | None = None


class CashSessionRead(_OrmBase):
    id: str
    store_id: str
    session_date: date
    opening_balance: Decimal
    closing_balance: Decimal | None
    status: str
    opened_by_id: str
    closed_by_id: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    payouts: list[CashPayoutRead] = []


# ── Promotions ────────────────────────────────────────────────────────────────

class PromotionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    discount_type: str = Field(pattern="^(PERCENT|FIXED)$")
    discount_value: Decimal = Field(gt=0)
    min_order_amount: Decimal = Field(ge=0, default=Decimal("0"))
    start_date: date | None = None
    end_date: date | None = None


class PromotionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = None
    discount_type: str | None = Field(None, pattern="^(PERCENT|FIXED)$")
    discount_value: Decimal | None = Field(None, gt=0)
    min_order_amount: Decimal | None = Field(None, ge=0)
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool | None = None


class PromotionRead(_OrmBase):
    id: str
    store_id: str
    name: str
    description: str | None
    discount_type: str
    discount_value: Decimal
    min_order_amount: Decimal
    start_date: date | None
    end_date: date | None
    is_active: bool
    created_by_id: str
    created_at: datetime
    updated_at: datetime


# ── Protocols ─────────────────────────────────────────────────────────────────

class ProtocolTaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    sort_order: int = Field(ge=0, default=0)


class ProtocolTaskRead(_OrmBase):
    id: str
    protocol_id: str
    title: str
    sort_order: int


class ProtocolCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    frequency: str = Field(pattern="^(DAILY|OPENING|CLOSING|WEEKLY)$")
    tasks: list[ProtocolTaskInput] = Field(default_factory=list)


class ProtocolRead(_OrmBase):
    id: str
    store_id: str
    name: str
    description: str | None
    frequency: str
    is_active: bool
    created_by_id: str
    created_at: datetime
    updated_at: datetime
    tasks: list[ProtocolTaskRead] = []


class ProtocolLogCreate(BaseModel):
    protocol_id: str
    log_date: date
    completed_task_ids: list[str] = Field(default_factory=list)


class ProtocolLogRead(_OrmBase):
    id: str
    protocol_id: str
    store_id: str
    log_date: date
    completed_task_ids: list[str]
    completed_by_id: str
    created_at: datetime
