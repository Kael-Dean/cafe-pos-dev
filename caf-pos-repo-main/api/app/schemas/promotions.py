from datetime import date, datetime, time
from decimal import Decimal

from pydantic import BaseModel, Field

from app.enums import PromotionScope, PromotionType


class PromotionBaselineResponse(BaseModel):
    product_id: str
    sales_window_days: int
    units_sold_in_window: Decimal
    avg_units_per_week: Decimal


class PromotionCreate(BaseModel):
    name: str = Field(max_length=120)
    type: PromotionType
    is_exclusive: bool = False
    discount_pct: Decimal = Field(gt=0, le=100)
    scope: PromotionScope = PromotionScope.ORDER
    product_ids_json: list[str] | None = None
    category_id: str | None = None
    min_quantity: int | None = Field(None, ge=1)
    bundle_product_ids_json: list[str] | None = None
    time_start: time | None = None
    time_end: time | None = None
    days_of_week_json: list[int] | None = None
    valid_from: date | None = None
    valid_until: date | None = None


class PromotionUpdate(BaseModel):
    name: str | None = Field(None, max_length=120)
    is_active: bool | None = None
    is_exclusive: bool | None = None
    discount_pct: Decimal | None = Field(None, gt=0, le=100)
    scope: PromotionScope | None = None
    product_ids_json: list[str] | None = None
    category_id: str | None = None
    min_quantity: int | None = Field(None, ge=1)
    bundle_product_ids_json: list[str] | None = None
    time_start: time | None = None
    time_end: time | None = None
    days_of_week_json: list[int] | None = None
    valid_from: date | None = None
    valid_until: date | None = None


class PromotionRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    store_id: str
    name: str
    type: PromotionType
    is_active: bool
    is_exclusive: bool
    discount_pct: Decimal | None
    scope: PromotionScope
    product_ids_json: list[str] | None
    category_id: str | None
    min_quantity: int | None
    bundle_product_ids_json: list[str] | None
    time_start: time | None
    time_end: time | None
    days_of_week_json: list[int] | None
    valid_from: date | None
    valid_until: date | None
    created_at: datetime
    updated_at: datetime


class PromotionListResponse(BaseModel):
    items: list[PromotionRead]
    total: int


class EvaluateItemIn(BaseModel):
    product_id: str
    quantity: int = Field(ge=1)


class EligiblePromotion(BaseModel):
    promotion_id: str
    name: str
    type: PromotionType
    discount_amount: Decimal
    is_exclusive: bool


class EvaluateRequest(BaseModel):
    items: list[EvaluateItemIn] = Field(min_length=1)


class EvaluateResponse(BaseModel):
    eligible: list[EligiblePromotion]
