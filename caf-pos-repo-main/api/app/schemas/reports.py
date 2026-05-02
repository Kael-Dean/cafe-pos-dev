from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class TopItem(BaseModel):
    product_name: str
    quantity: int
    revenue: Decimal


class DashboardTodayRead(BaseModel):
    revenue: Decimal
    order_count: int
    avg_ticket: Decimal
    top_items: list[TopItem]


class SalesBucket(BaseModel):
    bucket: str
    order_count: int
    revenue: Decimal


class SalesReportRead(BaseModel):
    from_: datetime
    to: datetime
    granularity: str
    buckets: list[SalesBucket]
    total_revenue: Decimal
    total_orders: int


class CogsItem(BaseModel):
    item_id: str
    item_name: str
    unit: str
    quantity_sold: Decimal
    cost_per_unit: Decimal
    total_cogs: Decimal


class CogsReportRead(BaseModel):
    from_: datetime
    to: datetime
    items: list[CogsItem]
    total_cogs: Decimal


class WastageByReason(BaseModel):
    reason_code: str
    event_count: int
    total_quantity: Decimal
    estimated_cost: Decimal


class WastageReportRead(BaseModel):
    from_: datetime
    to: datetime
    by_reason: list[WastageByReason]
    total_quantity: Decimal
    total_cost: Decimal


class LowStockItem(BaseModel):
    item_id: str
    item_name: str
    unit: str
    stock_on_hand: Decimal
    par_level: Decimal
    deficit: Decimal


class LowStockReportRead(BaseModel):
    items: list[LowStockItem]
    total_items: int


class CashierShift(BaseModel):
    user_id: str
    user_name: str
    order_count: int
    revenue: Decimal
    void_count: int


class CashierShiftsReportRead(BaseModel):
    from_: datetime
    to: datetime
    cashiers: list[CashierShift]
