from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.enums import Channel, OrderStatus, PaymentMethod


class OrderItemIn(BaseModel):
    product_id: str
    quantity: int = Field(ge=1)
    modifier_ids: list[str] = Field(default_factory=list)


class CreateOrderRequest(BaseModel):
    idempotency_key: str = Field(max_length=120)
    channel: Channel
    customer_id: str | None = None
    customer_note: str | None = None
    items: list[OrderItemIn] = Field(min_length=1)


class PayOrderRequest(BaseModel):
    payment_method: PaymentMethod
    payment_ref: str | None = None


class UpdateStatusRequest(BaseModel):
    status: OrderStatus


class VoidOrderRequest(BaseModel):
    reason: str | None = None


class OrderItemRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    order_id: str
    product_id: str | None
    product_name: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    modifiers_json: dict | None


class OrderRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    order_number: int
    store_id: str
    customer_id: str | None
    status: OrderStatus
    channel: Channel
    payment_method: PaymentMethod | None
    payment_ref: str | None
    customer_note: str | None
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal
    created_by_id: str
    items: list[OrderItemRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class OrdersPage(BaseModel):
    items: list[OrderRead]
    total: int
    page: int
    limit: int
