import enum


class Role(enum.StrEnum):
    OWNER = "OWNER"
    MANAGER = "MANAGER"
    BARISTA = "BARISTA"
    BAKER = "BAKER"


class ProductType(enum.StrEnum):
    MADE_TO_ORDER = "MADE_TO_ORDER"
    PRODUCED = "PRODUCED"


class MovementType(enum.StrEnum):
    RECEIVE = "RECEIVE"
    SALE = "SALE"
    WASTE = "WASTE"
    ADJUST = "ADJUST"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"
    PRODUCTION_USE = "PRODUCTION_USE"   # raw ingredients consumed in a production run
    PRODUCTION = "PRODUCTION"           # finished goods added by a production run


class WastageReason(enum.StrEnum):
    EXPIRED = "EXPIRED"
    SPILLED = "SPILLED"
    TRIAL = "TRIAL"
    DAMAGED = "DAMAGED"
    OTHER = "OTHER"


class OrderStatus(enum.StrEnum):
    PENDING = "PENDING"
    PAID = "PAID"
    IN_PROGRESS = "IN_PROGRESS"
    READY = "READY"
    COMPLETED = "COMPLETED"
    VOID = "VOID"


class Channel(enum.StrEnum):
    DINE_IN = "DINE_IN"
    TAKEAWAY = "TAKEAWAY"
    DELIVERY = "DELIVERY"


class PaymentMethod(enum.StrEnum):
    CASH = "CASH"
    CARD = "CARD"
    QR_PROMPTPAY = "QR_PROMPTPAY"
    LINE_PAY = "LINE_PAY"
    TRUEMONEY = "TRUEMONEY"
    OTHER = "OTHER"


class LeaveType(enum.StrEnum):
    VACATION = "VACATION"
    SICK = "SICK"
    PERSONAL = "PERSONAL"
    OTHER = "OTHER"


class LeaveStatus(enum.StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class TaskStatus(enum.StrEnum):
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    PENDING_REVIEW = "PENDING_REVIEW"
    DONE = "DONE"


class ReceiptStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    CONFIRMED = "CONFIRMED"


class PreOrderStatus(enum.StrEnum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class FulfillmentMode(enum.StrEnum):
    PRODUCE_FRESH = "PRODUCE_FRESH"
    FROM_INVENTORY = "FROM_INVENTORY"


class StaffPosition(enum.StrEnum):
    JUNIOR = "JUNIOR"
    SENIOR = "SENIOR"
    HEAD_OF_STAFF = "HEAD_OF_STAFF"


class EarnMode(enum.StrEnum):
    PER_RECEIPT = "PER_RECEIPT"   # 1 point per paid order
    PER_BAHT    = "PER_BAHT"      # 1 point per N baht (N = baht_per_point)
    PER_ITEM    = "PER_ITEM"      # 1 point per item quantity across all lines


class RewardType(enum.StrEnum):
    DISCOUNT_FIXED   = "DISCOUNT_FIXED"    # N baht off total
    DISCOUNT_PERCENT = "DISCOUNT_PERCENT"  # N% off total
    FREE_ITEM        = "FREE_ITEM"         # one eligible item at 0 baht


class RewardScope(enum.StrEnum):
    ALL               = "ALL"
    CATEGORY          = "CATEGORY"
    SPECIFIC_PRODUCTS = "SPECIFIC_PRODUCTS"


class PointTxType(enum.StrEnum):
    EARN   = "EARN"
    REDEEM = "REDEEM"
    ADJUST = "ADJUST"
    EXPIRE = "EXPIRE"


class MembershipTier(enum.StrEnum):
    NONE   = "NONE"
    BRONZE = "BRONZE"
    SILVER = "SILVER"
    GOLD   = "GOLD"


class PromotionType(enum.StrEnum):
    PERCENT_OFF    = "PERCENT_OFF"
    COMBO_BUNDLE   = "COMBO_BUNDLE"
    COMBO_QUANTITY = "COMBO_QUANTITY"
    HAPPY_HOUR     = "HAPPY_HOUR"


class PromotionScope(enum.StrEnum):
    ORDER    = "ORDER"
    CATEGORY = "CATEGORY"
    PRODUCT  = "PRODUCT"
