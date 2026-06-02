from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProductionOrderCreate(BaseModel):
    product_id: str
    batches_count: int = Field(ge=1)
    notes: str | None = Field(None, max_length=500)


class ProductionOrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    store_id: str
    product_id: str
    batches_count: int
    units_produced: int
    produced_by: str
    produced_at: datetime
    notes: str | None
