from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class StockTakePreviewItem(BaseModel):
    inventory_item_id: str
    name: str
    unit: str
    consumed_in_period: Decimal
    system_quantity: Decimal


class StockTakePreview(BaseModel):
    period_start: datetime
    period_end: datetime
    items: list[StockTakePreviewItem]


class StockTakeSubmitItem(BaseModel):
    inventory_item_id: str
    actual_quantity: Decimal = Field(ge=0)


class StockTakeSubmit(BaseModel):
    items: list[StockTakeSubmitItem]
    notes: str | None = Field(None, max_length=500)


class StockTakeAdjustResult(BaseModel):
    inventory_item_id: str
    name: str
    unit: str
    system_quantity: Decimal
    actual_quantity: Decimal
    variance: Decimal


class StockTakeHistoryItem(BaseModel):
    name: str
    unit: str
    system_quantity: Decimal
    actual_quantity: Decimal
    variance: Decimal


class StockTakeEvent(BaseModel):
    conducted_at: datetime
    conducted_by: str
    item_count: int
    items: list[StockTakeHistoryItem]
