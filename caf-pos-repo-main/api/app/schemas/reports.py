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
    unit_size: Decimal | None = None
    pieces_consumed: Decimal | None = None


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


class WastageByDay(BaseModel):
    bucket: str  # "YYYY-MM-DD"
    event_count: int
    total_quantity: Decimal
    estimated_cost: Decimal


class WastageByItem(BaseModel):
    item_id: str
    item_name: str
    unit: str
    event_count: int
    total_quantity: Decimal
    estimated_cost: Decimal


class WastageEvent(BaseModel):
    id: str
    created_at: datetime
    item_name: str
    unit: str
    quantity: Decimal
    reason_code: str  # decoded WastageReason value, or "OTHER" if unknown/missing
    note: str | None
    created_by_name: str
    estimated_cost: Decimal


class WastageReportRead(BaseModel):
    from_: datetime
    to: datetime
    total_quantity: Decimal
    total_cost: Decimal
    event_count: int
    by_reason: list[WastageByReason]
    by_day: list[WastageByDay]
    by_item: list[WastageByItem]
    events: list[WastageEvent]  # chronological ASC by created_at


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


class KpiItemRead(BaseModel):
    product_name: str
    quantity: int
    value: Decimal


class KpiMemberRead(BaseModel):
    customer_id: str
    name: str
    phone: str | None
    order_count: int
    total_items: int
    total_value: Decimal
    items: list[KpiItemRead]


class KpiSalespersonRead(BaseModel):
    sales_id: str
    sales_name: str
    member_count: int
    buying_member_count: int
    total_items: int
    total_value: Decimal
    members: list[KpiMemberRead]


class SalespersonKpiReportRead(BaseModel):
    from_: datetime
    to: datetime
    salespeople: list[KpiSalespersonRead]
