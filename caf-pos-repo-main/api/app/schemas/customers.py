from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field

from app.enums import Channel, OrderStatus


class CreateCustomerRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None
    notes: str | None = None


class UpdateCustomerRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None
    notes: str | None = None


class OrderSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    order_number: int
    status: OrderStatus
    channel: Channel
    total: Decimal
    created_at: datetime


class CustomerRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    store_id: str
    name: str
    phone: str | None
    email: str | None
    notes: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    recent_orders: list[OrderSummary] = []


class CustomersPage(BaseModel):
    items: list[CustomerRead]
    total: int
    page: int
    limit: int
