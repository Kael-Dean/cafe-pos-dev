import enum


class Role(str, enum.Enum):
    OWNER = "OWNER"
    MANAGER = "MANAGER"
    BARISTA = "BARISTA"
    BAKER = "BAKER"


class MovementType(str, enum.Enum):
    RECEIVE = "RECEIVE"
    SALE = "SALE"
    WASTE = "WASTE"
    ADJUST = "ADJUST"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"


class WastageReason(str, enum.Enum):
    EXPIRED = "EXPIRED"
    SPILLED = "SPILLED"
    TRIAL = "TRIAL"
    DAMAGED = "DAMAGED"
    OTHER = "OTHER"


class OrderStatus(str, enum.Enum):
    PENDING = "PENDING"
    PAID = "PAID"
    IN_PROGRESS = "IN_PROGRESS"
    READY = "READY"
    COMPLETED = "COMPLETED"
    VOID = "VOID"


class Channel(str, enum.Enum):
    DINE_IN = "DINE_IN"
    TAKEAWAY = "TAKEAWAY"
    DELIVERY = "DELIVERY"


class PaymentMethod(str, enum.Enum):
    CASH = "CASH"
    CARD = "CARD"
    QR_PROMPTPAY = "QR_PROMPTPAY"
    LINE_PAY = "LINE_PAY"
    TRUEMONEY = "TRUEMONEY"
    OTHER = "OTHER"
