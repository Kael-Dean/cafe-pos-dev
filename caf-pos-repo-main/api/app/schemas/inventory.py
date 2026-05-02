from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.enums import MovementType, WastageReason

ItemStatus = Literal["ok", "low", "critical"]


class _DecimalConfig(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class InventoryItemBase(_DecimalConfig):
    id: str
    name: str
    unit: str
    cost_per_unit: Decimal
    stock_on_hand: Decimal
    par_level: Decimal
    is_active: bool
    expiry_date: date | None = None


class InventoryItemRead(InventoryItemBase):
    status: ItemStatus = "ok"

    @model_validator(mode="after")
    def _compute_status(self) -> "InventoryItemRead":
        par = self.par_level
        soh = self.stock_on_hand
        if par > 0 and soh < par * Decimal("0.5"):
            self.status = "critical"
        elif par > 0 and soh < par:
            self.status = "low"
        else:
            self.status = "ok"
        return self


class InventoryItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    unit: str = Field(min_length=1, max_length=24)
    par_level: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("9999999.999"))
    cost_per_unit: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("99999.9999"))
    is_active: bool = True
    expiry_date: date | None = None


class InventoryItemUpdate(BaseModel):
    par_level: Decimal | None = Field(None, ge=0, le=Decimal("9999999.999"))
    cost_per_unit: Decimal | None = Field(None, ge=0, le=Decimal("99999.9999"))
    is_active: bool | None = None
    expiry_date: date | None = None


class ReceiveStockRequest(BaseModel):
    item_id: str
    qty: Decimal = Field(gt=0, le=Decimal("999999.999"))
    cost_per_unit: Decimal = Field(ge=0, le=Decimal("99999.9999"))
    supplier: str | None = Field(None, max_length=120)
    note: str | None = Field(None, max_length=500)


class WasteRequest(BaseModel):
    item_id: str
    qty: Decimal = Field(gt=0, le=Decimal("999999.999"))
    reason: WastageReason
    note: str | None = Field(None, max_length=500)


class AdjustRequest(BaseModel):
    item_id: str
    delta: Decimal = Field(le=Decimal("999999.999"), ge=Decimal("-999999.999"))
    reason: str = Field(min_length=3, max_length=500)


class CreatedBy(BaseModel):
    id: str
    name: str


class StockMovementRead(BaseModel):
    id: str
    type: MovementType
    inventory_item_id: str
    quantity: Decimal
    reason_code: WastageReason | None = None
    note: str | None = None
    supplier: str | None = None
    raw_reason: str | None = None
    ref_order_id: str | None = None
    created_by: CreatedBy
    created_at: datetime


class MovementsPage(BaseModel):
    items: list[StockMovementRead]
    next_cursor: str | None = None
