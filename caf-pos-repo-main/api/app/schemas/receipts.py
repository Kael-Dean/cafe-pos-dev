from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.inventory import CreatedBy


class _Cfg(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class StockReceiptCreate(BaseModel):
    supplier_name: str | None = Field(None, max_length=120)
    receipt_ref: str | None = Field(None, max_length=80)
    note: str | None = Field(None, max_length=1000)
    received_at: date = Field(default_factory=date.today)


class StockLotCreate(BaseModel):
    inventory_item_id: str
    qty_packs: Decimal = Field(gt=0, le=Decimal("999999.999"))
    unit_price: Decimal = Field(gt=0, le=Decimal("99999.99"))
    expiry_date: date | None = None


class StockLotRead(_Cfg):
    id: str
    inventory_item_id: str
    inventory_item_name: str
    qty_packs: Decimal
    qty_received: Decimal
    qty_remaining: Decimal
    unit_price: Decimal
    cost_per_unit: Decimal
    expiry_date: date | None
    created_at: datetime


class StockReceiptRead(_Cfg):
    id: str
    status: str
    supplier_name: str | None
    receipt_ref: str | None
    note: str | None
    received_at: date
    created_by: CreatedBy
    created_at: datetime
    lots: list[StockLotRead]


class StockReceiptSummary(_Cfg):
    id: str
    status: str
    supplier_name: str | None
    receipt_ref: str | None
    received_at: date
    lot_count: int
    created_at: datetime


class StockReceiptsPage(BaseModel):
    items: list[StockReceiptSummary]
    next_cursor: str | None = None


class ExpiredLotRead(_Cfg):
    lot_id: str
    inventory_item_id: str
    inventory_item_name: str
    unit: str
    qty_remaining: Decimal
    expiry_date: date
