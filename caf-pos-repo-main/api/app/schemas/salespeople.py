from pydantic import BaseModel, Field


class SalespersonRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    name: str
    is_active: bool


class SalespersonCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SalespersonUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    is_active: bool | None = None


class AssignSalesRequest(BaseModel):
    sales_id: str | None = None
