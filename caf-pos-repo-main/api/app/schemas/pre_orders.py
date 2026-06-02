from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.enums import FulfillmentMode


class _Cfg(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Pre-Order Item ----------

class PreOrderItemIn(BaseModel):
    product_id: str | None = None
    product_name: str | None = Field(None, max_length=200)
    quantity: int = Field(ge=1)
    unit_price: Decimal | None = Field(None, ge=0)


class PreOrderItemRead(_Cfg):
    id: str
    product_id: str | None
    product_name: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    fulfillment_mode: FulfillmentMode | None = None


class FulfillmentModeUpdate(BaseModel):
    fulfillment_mode: FulfillmentMode


# ---------- Pre-Order ----------

class PreOrderCreate(BaseModel):
    order_date: date
    due_date: date
    customer_id: str | None = None
    customer_name: str | None = Field(None, max_length=120)
    customer_phone: str | None = Field(None, max_length=30)
    deposit_amount: Decimal | None = Field(None, ge=0)
    deposit_paid: bool = False
    notes: str | None = None
    items: list[PreOrderItemIn] = Field(min_length=1)


class PreOrderUpdate(BaseModel):
    order_date: date | None = None
    due_date: date | None = None
    customer_id: str | None = None
    customer_name: str | None = Field(None, max_length=120)
    customer_phone: str | None = Field(None, max_length=30)
    deposit_amount: Decimal | None = Field(None, ge=0)
    deposit_paid: bool | None = None
    notes: str | None = None


class PreOrderRead(_Cfg):
    id: str
    store_id: str
    order_date: date
    due_date: date
    customer_id: str | None
    customer_name: str | None
    customer_phone: str | None
    deposit_amount: Decimal | None
    deposit_paid: bool
    notes: str | None
    status: str
    created_by_id: str
    started_by_id: str | None
    completed_by_id: str | None
    started_at: datetime | None
    completed_at: datetime | None
    items: list[PreOrderItemRead]
    created_at: datetime
    updated_at: datetime


class PreOrderSummary(_Cfg):
    id: str
    order_date: date
    due_date: date
    customer_name: str | None
    customer_phone: str | None
    status: str
    item_count: int
    created_at: datetime


class PreOrdersPage(BaseModel):
    items: list[PreOrderSummary]
    total: int


# ---------- Ingredient Summary ----------

class IngredientSummaryItem(BaseModel):
    inventory_item_id: str
    name: str
    unit: str
    qty_needed: Decimal
    stock_on_hand: Decimal
    usage_pct: float | None
    exceeds_threshold: bool
    on_shopping_list: bool


class IngredientSummary(BaseModel):
    items: list[IngredientSummaryItem]
    threshold: float


# ---------- Shopping List ----------

class ShoppingListItemCreate(BaseModel):
    inventory_item_id: str
    note: str | None = Field(None, max_length=255)


class ShoppingListItemRead(_Cfg):
    id: str
    inventory_item_id: str
    inventory_item_name: str
    unit: str
    note: str | None
    added_by_id: str
    created_at: datetime
