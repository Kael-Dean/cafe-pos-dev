from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class _ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Category
# ---------------------------------------------------------------------------


class CategoryRead(_ORM):
    id: str
    store_id: str
    name: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = Field(0, ge=0)


class CategoryUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    sort_order: int | None = Field(None, ge=0)


# ---------------------------------------------------------------------------
# Modifier / ModifierGroup
# ---------------------------------------------------------------------------


class ModifierRead(_ORM):
    id: str
    name: str
    price_delta: Decimal
    inventory_item_id: str | None
    inventory_qty: Decimal | None
    sort_order: int
    is_active: bool


class ModifierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    price_delta: Decimal = Field(Decimal("0"), ge=Decimal("-9999.99"), le=Decimal("9999.99"))
    inventory_item_id: str | None = None
    inventory_qty: Decimal | None = Field(None, gt=0)
    sort_order: int = Field(0, ge=0)


class ModifierGroupRead(BaseModel):
    id: str
    store_id: str
    name: str
    required: bool
    min_select: int
    max_select: int | None
    is_active: bool
    modifiers: list[ModifierRead] = []


class ModifierGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    required: bool = False
    min_select: int = Field(0, ge=0)
    max_select: int | None = Field(None, ge=1)
    modifiers: list[ModifierCreate] = []


class ModifierGroupUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    required: bool | None = None
    min_select: int | None = Field(None, ge=0)
    max_select: int | None = Field(None, ge=1)
    # When present, bulk-replaces all modifiers in the group.
    modifiers: list[ModifierCreate] | None = None


# ---------------------------------------------------------------------------
# Product
# ---------------------------------------------------------------------------


class RecipeItemRead(_ORM):
    id: str
    inventory_item_id: str
    quantity: Decimal


class RecipeItemInput(BaseModel):
    inventory_item_id: str
    quantity: Decimal = Field(gt=0, le=Decimal("999999.999"))


class RecipeBulkReplace(BaseModel):
    items: list[RecipeItemInput]


class ProductModifierGroupsReplace(BaseModel):
    # Ordered list — index becomes sort_order.
    modifier_group_ids: list[str]


class ProductRead(_ORM):
    id: str
    store_id: str
    category_id: str | None
    name: str
    description: str | None
    price: Decimal
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ProductDetail(ProductRead):
    recipe: list[RecipeItemRead] = []
    modifier_groups: list[ModifierGroupRead] = []


class ProductCreate(BaseModel):
    category_id: str | None = None
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)
    price: Decimal = Field(ge=Decimal("0"), le=Decimal("999999.99"))
    is_active: bool = True


class ProductUpdate(BaseModel):
    category_id: str | None = None
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = None
    price: Decimal | None = Field(None, ge=Decimal("0"), le=Decimal("999999.99"))
    is_active: bool | None = None
