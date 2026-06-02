from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.enums import EarnMode, MembershipTier, PointTxType, RewardScope, RewardType


class UpsertProgramRequest(BaseModel):
    is_active: bool = True
    earn_mode: EarnMode = EarnMode.PER_RECEIPT
    baht_per_point: Decimal | None = None
    points_to_redeem: int = Field(gt=0)
    reward_type: RewardType = RewardType.DISCOUNT_FIXED
    reward_value: Decimal | None = None
    reward_scope: RewardScope = RewardScope.ALL
    reward_category_id: str | None = None
    min_order_baht: Decimal | None = None
    points_expire_after_days: int | None = Field(default=None, gt=0)
    tier_bronze_threshold: int | None = Field(default=None, gt=0)
    tier_silver_threshold: int | None = Field(default=None, gt=0)
    tier_gold_threshold: int | None = Field(default=None, gt=0)
    bronze_earn_multiplier: Decimal = Decimal("1.0")
    silver_earn_multiplier: Decimal = Decimal("1.0")
    gold_earn_multiplier: Decimal = Decimal("1.0")

    @model_validator(mode="after")
    def _validate(self) -> "UpsertProgramRequest":
        if self.earn_mode == EarnMode.PER_BAHT:
            if not self.baht_per_point or self.baht_per_point <= 0:
                raise ValueError("baht_per_point must be > 0 for PER_BAHT earn mode")
        if self.reward_type in (RewardType.DISCOUNT_FIXED, RewardType.DISCOUNT_PERCENT):
            if not self.reward_value or self.reward_value <= 0:
                raise ValueError("reward_value must be > 0 for this reward type")
        if self.reward_type == RewardType.DISCOUNT_PERCENT:
            if self.reward_value and self.reward_value > 100:
                raise ValueError("reward_value cannot exceed 100 for DISCOUNT_PERCENT")
        if self.reward_scope == RewardScope.CATEGORY and not self.reward_category_id:
            raise ValueError("reward_category_id required when reward_scope is CATEGORY")
        if self.tier_bronze_threshold and self.tier_silver_threshold:
            if self.tier_silver_threshold <= self.tier_bronze_threshold:
                raise ValueError("tier_silver_threshold must exceed tier_bronze_threshold")
        if self.tier_silver_threshold and self.tier_gold_threshold:
            if self.tier_gold_threshold <= self.tier_silver_threshold:
                raise ValueError("tier_gold_threshold must exceed tier_silver_threshold")
        return self


class ProgramRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    store_id: str
    is_active: bool
    earn_mode: EarnMode
    baht_per_point: Decimal | None
    points_to_redeem: int
    reward_type: RewardType
    reward_value: Decimal | None
    reward_scope: RewardScope
    reward_category_id: str | None
    min_order_baht: Decimal | None
    points_expire_after_days: int | None
    tier_bronze_threshold: int | None
    tier_silver_threshold: int | None
    tier_gold_threshold: int | None
    bronze_earn_multiplier: Decimal
    silver_earn_multiplier: Decimal
    gold_earn_multiplier: Decimal
    created_at: datetime
    updated_at: datetime


class SetRewardProductsRequest(BaseModel):
    product_ids: list[str]


class RewardProductRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    name: str
    price: Decimal


class LookupRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=30)


class RegisterMemberRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=1, max_length=30)
    date_of_birth: date | None = None


class AccountRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    customer_id: str
    customer_name: str
    phone: str | None
    points_balance: int
    lifetime_points_earned: int
    tier: MembershipTier
    date_of_birth: date | None
    joined_at: datetime


class LookupRewardInfo(BaseModel):
    points_to_redeem: int
    reward_type: RewardType
    reward_scope: RewardScope
    reward_category_name: str | None


class LookupResponse(BaseModel):
    found: bool
    account: AccountRead | None = None
    program: LookupRewardInfo | None = None
    reward_redeemable: bool = False
    points_to_next_reward: int | None = None
    eligible_reward_products: list[RewardProductRead] = []


class AdjustPointsRequest(BaseModel):
    delta: int
    note: str = Field(min_length=1)


class PointTransactionRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    type: PointTxType
    delta: int
    balance_after: int
    order_id: str | None
    note: str | None
    created_at: datetime


class MemberRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    customer_id: str
    customer_name: str
    phone: str | None
    points_balance: int
    lifetime_points_earned: int
    tier: MembershipTier
    date_of_birth: date | None
    joined_at: datetime
    recent_transactions: list[PointTransactionRead] = []


class MembersPage(BaseModel):
    items: list[AccountRead]
    total: int
    page: int
    limit: int
